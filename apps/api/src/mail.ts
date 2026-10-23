import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import nodemailer from 'nodemailer';
import type { Pool, PoolClient } from 'pg';
import type { Config } from './config.js';

type Kind = 'verify' | 'reset' | 'invite';
type Payload = { to: string; url: string; workspace?: string };
type Queryable = Pool | PoolClient;
export function mailbox(value: unknown): string {
  if (typeof value !== 'string' || value.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(value)) throw new Error('Invalid email address');
  return value.toLowerCase();
}
function keyFromHex(key: string) {
  if (!/^[a-f0-9]{64}$/i.test(key)) throw new Error('MAIL_ENCRYPTION_KEY must be 32 random bytes encoded as hex');
  return Buffer.from(key,'hex');
}
const aad = (id: string,kind: Kind,org?: string | null) => Buffer.from(`desvio-mail-v1:${id}:${kind}:${org ?? ''}`);

export class MailQueue {
  private readonly key: Buffer;
  constructor(readonly origin: string,key: string,readonly enabled=true) { this.key=keyFromHex(key); }
  async enqueue(db: Queryable,kind: Kind,payload: Payload,expiresAt: Date,org?: string,actor?: string) {
    if(!this.enabled)throw new Error('Email delivery is disabled');
    mailbox(payload.to);
    if(new URL(payload.url).origin!==this.origin) throw new Error('Email links must use the configured app origin');
    const id=randomUUID(),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,iv);
    cipher.setAAD(aad(id,kind,org));
    const ciphertext=Buffer.concat([cipher.update(JSON.stringify(payload)),cipher.final()]);
    const encrypted=Buffer.concat([Buffer.from([1]),iv,cipher.getAuthTag(),ciphertext]);
    const dedupe=createHash('sha256').update(JSON.stringify({kind,org,to:payload.to,url:payload.url})).digest('hex');
    const {rows}=await db.query(`INSERT INTO delivery.outbox(id,kind,organization_id,actor_id,dedupe_key,encrypted_payload,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(dedupe_key) DO NOTHING RETURNING id`,[id,kind,org??null,actor??null,dedupe,encrypted,expiresAt]);
    if(rows[0]) return rows[0].id as string;
    const prior=await db.query('SELECT id FROM delivery.outbox WHERE dedupe_key=$1',[dedupe]);
    if(!prior.rows[0]) throw new Error('Email queue conflict');
    return prior.rows[0].id as string;
  }
  decrypt(row: {id:string;kind:Kind;organization_id:string|null;encrypted_payload:Buffer}): Payload {
    const buffer=row.encrypted_payload;
    if(!buffer || buffer.length<30 || buffer[0]!==1) throw new Error('Invalid encrypted email');
    const decipher=createDecipheriv('aes-256-gcm',this.key,buffer.subarray(1,13));
    decipher.setAAD(aad(row.id,row.kind,row.organization_id));decipher.setAuthTag(buffer.subarray(13,29));
    const value=JSON.parse(Buffer.concat([decipher.update(buffer.subarray(29)),decipher.final()]).toString());
    mailbox(value.to);
    if(typeof value.url!=='string' || new URL(value.url).origin!==this.origin || (value.workspace && typeof value.workspace!=='string')) throw new Error('Invalid email content');
    return value;
  }
}

export class MailWorker {
  private readonly transport?: ReturnType<typeof nodemailer.createTransport>;
  constructor(readonly db: Pool,readonly queue: MailQueue,readonly config: Config) {
    const smtp=config.smtp;
    if(!smtp){if(!['test','development','staging'].includes(config.mode))throw new Error('Email configuration required');return;}
    mailbox(smtp.from);
    const local=['test','development'].includes(config.mode) && ['127.0.0.1','localhost','::1'].includes(smtp.host);
    if(!local && (!smtp.user || !smtp.password)) throw new Error('Authenticated SMTP required');
    this.transport=nodemailer.createTransport({host:smtp.host,port:smtp.port,secure:smtp.secure,
      requireTLS:!local,ignoreTLS:local&&!smtp.secure,auth:smtp.user?{user:smtp.user,pass:smtp.password}:undefined,
      tls:{rejectUnauthorized:true,minVersion:'TLSv1.2'},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:30000,
      disableFileAccess:true,disableUrlAccess:true,logger:false,debug:false});
  }
  async assertRole() {
    const {rows:[role]}=await this.db.query('SELECT current_user AS name,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user');
    if(role.name!=='desvio_mail' || role.rolsuper || role.rolbypassrls) throw new Error('Unsafe email worker database role');
  }
  async runOnce(): Promise<{id:string;status:string}|null> {
    const smtp=this.config.smtp;if(!smtp||!this.transport)return null;
    // A killed worker may have submitted DATA. Never automatically send those rows again.
    await this.db.query(`UPDATE delivery.outbox SET status='unknown',error_code='WORKER_LOST',lease_id=NULL,leased_until=NULL
      WHERE status='processing' AND leased_until<now()`);
    await this.db.query(`UPDATE delivery.outbox SET status='expired',encrypted_payload=NULL WHERE status IN ('pending','retry','unknown') AND expires_at<=now()`);
    const lease=randomUUID();
    const {rows:[row]}=await this.db.query(`UPDATE delivery.outbox SET status='processing',attempts=attempts+1,lease_id=$1,leased_until=now()+interval '2 minutes'
      WHERE id=(SELECT id FROM delivery.outbox WHERE status IN ('pending','retry') AND available_at<=now() AND expires_at>now()
        ORDER BY available_at,created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`,[lease]);
    if(!row) return null;
    let payload: Payload;
    try {payload=this.queue.decrypt(row);} catch {await this.finish(row.id,lease,'failed','INVALID_ENCRYPTED_PAYLOAD');return{id:row.id,status:'failed'};}
    const subject=row.kind==='verify'?'Verify your Desvio email':row.kind==='reset'?'Reset your Desvio password':'Your Desvio client invitation';
    const heading=row.kind==='invite'?`You have been invited to ${payload.workspace ?? 'a client workspace'}.`:
      row.kind==='verify'?'Verify your email to continue with Desvio.':'Use this link to choose a new password.';
    try {
      const result=await this.transport.sendMail({from:{name:'Desvio',address:smtp.from},to:payload.to,subject,
        text:`${heading}\n\n${payload.url}\n\nThis link expires. If you did not request this message, you can ignore it.`,
        textEncoding:'base64',messageId:`<${row.id}@${smtp.from.split('@')[1]}>`});
      if(result.accepted.length!==1 || result.rejected.length) {
        await this.finish(row.id,lease,'failed','RECIPIENT_REJECTED');return{id:row.id,status:'failed'};
      }
      // SMTP acceptance is not proof of inbox delivery. The UI must use this exact distinction.
      await this.finish(row.id,lease,'accepted',null);return{id:row.id,status:'accepted'};
    } catch(error) {
      const e=error as {responseCode?:number;code?:string;command?:string};
      const definiteRejection=typeof e.responseCode==='number';
      const permanent=e.code==='EAUTH' || (e.responseCode ?? 0)>=500;
      // Connection errors may be labelled CONN even after DATA was accepted. Without
      // an SMTP rejection, a network failure is ambiguous and must not auto-resend.
      const status=permanent?'failed':definiteRejection?(row.attempts<5?'retry':'failed'):'unknown';
      const code=definiteRejection?`SMTP_${e.responseCode}`:permanent?'SMTP_AUTH_FAILED':status==='unknown'?'SMTP_OUTCOME_UNKNOWN':'SMTP_TEMPORARY_FAILURE';
      await this.finish(row.id,lease,status,code,row.attempts);return{id:row.id,status};
    }
  }
  private async finish(id:string,lease:string,status:string,code:string|null,attempts=1) {
    const result=await this.db.query(`UPDATE delivery.outbox SET status=$3,error_code=$4,lease_id=NULL,leased_until=NULL,
      available_at=now()+($5::int*interval '1 second'),encrypted_payload=CASE WHEN $3 IN ('accepted','failed') THEN NULL ELSE encrypted_payload END
      WHERE id=$1 AND lease_id=$2 AND status='processing'`,[id,lease,status,code,Math.min(3600,30*2**attempts)]);
    if(result.rowCount!==1) throw new Error('Email worker lease no longer active');
  }
  close() {this.transport?.close();}
}
