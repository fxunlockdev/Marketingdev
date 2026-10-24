import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { TenantDatabase } from './database.js';
import { MailQueue, mailbox } from './mail.js';
import {Businesses} from './businesses.js';
import {Workspaces} from './workspaces.js';
import { object,uuid } from './workspaces.js';

const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
function invitationRole(value:unknown): string {
  if(typeof value!=='string' || !['admin','editor','reviewer','analyst','viewer'].includes(value)) throw new BadRequestException('Choose a supported business role');
  return value;
}
function key(value:unknown):string {
  if(typeof value!=='string' || !/^[A-Za-z0-9_.:-]{8,128}$/.test(value)) throw new BadRequestException('An Idempotency-Key is required');
  return value;
}
function teamError(error:unknown):never {
  const code=(error as {code?:string})?.code;
  if(code==='42501') throw new ForbiddenException('You do not have permission to make this team change');
  if(code==='P0002') throw new NotFoundException('Invitation unavailable or expired');
  if(code==='23514') throw new ConflictException('Keep at least one active workspace owner');
  if(code==='23505') throw new ConflictException('Already a member; an owner can change the role');
  throw error;
}
export class Team {
  constructor(readonly database:TenantDatabase,readonly mail:MailQueue,readonly origin:string) {}
  private async accountScope(db:PoolClient,user:string,org:string){const member=(await db.query('SELECT business_scope FROM app.memberships WHERE organization_id=$1 AND user_id=$2 AND active',[org,user])).rows[0];if(member?.business_scope!=='all')throw new ForbiddenException('Account-wide team access is restricted');}
  private async admin(db:PoolClient,user:string,org:string) {
    const {rows:[member]}=await db.query('SELECT role,business_scope FROM app.memberships WHERE organization_id=$1 AND user_id=$2 AND active',[org,user]);
    if(!member || member.business_scope!=='all' || !['owner','admin'].includes(member.role)) throw new ForbiddenException('Only workspace owners and admins can manage invitations');
    return member.role as string;
  }
  list(user:string,organizationId:string) {
    return this.database.transaction(user,uuid(organizationId),false,async db=>{await this.accountScope(db,user,organizationId);return {members:(await db.query('SELECT * FROM app.team_members()')).rows};}).catch(teamError);
  }
  invitations(user:string,organizationId:string) {
    const org=uuid(organizationId);
    return this.database.transaction(user,org,false,async db=>{
      await this.admin(db,user,org);
      const {rows}=await db.query(`SELECT i.id,i.email,i.role,i.business_ids,CASE WHEN i.status='pending' AND i.expires_at<=now() THEN 'expired' ELSE i.status END AS status,
        i.expires_at,m.status AS email_status,m.error_code FROM app.invitations i JOIN delivery.outbox m ON m.id=i.mail_id
        WHERE i.organization_id=$1 ORDER BY i.created_at DESC LIMIT 100`,[org]);
      return{invitations:rows};
    });
  }
  invite(user:string,organizationId:string,input:unknown,idempotency:unknown,businessContext?:string) {
    const org=uuid(organizationId),value=object(input,['email','role','business_ids']),role=invitationRole(value.role),requestKey=key(idempotency);
    let email:string;try{email=mailbox(value.email);}catch{throw new BadRequestException('Enter a valid email address');}
    let businessIds:string[]|null=null;
    if(value.business_ids!==undefined){if(!Array.isArray(value.business_ids)||value.business_ids.length<1||value.business_ids.length>1000)throw new BadRequestException('Select one or more businesses');businessIds=value.business_ids.map(v=>uuid(String(v))).sort();if(new Set(businessIds).size!==businessIds.length)throw new BadRequestException('Select each business once');}
    if(!businessIds&&['reviewer','analyst'].includes(role))throw new BadRequestException('This role requires selected businesses');
    const requestHash=digest(JSON.stringify({email,role,...(businessIds?{business_ids:businessIds}:{})}));
    return this.database.transaction(user,org,true,async db=>{
      // Same lock as role changes and acceptance: permissions cannot change mid-invitation.
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`members:${org}`]);
      const actorRole=businessContext?'business':await this.admin(db,user,org);
      if(!(await db.query('SELECT app.invitation_authorized($1,$2,$3,$4) AS allowed',[org,user,businessIds,role])).rows[0].allowed)throw new ForbiddenException('You can invite non-admin teammates only to businesses you administer');
      const selectedBusinesses=businessIds?(await db.query('SELECT * FROM app.invitation_businesses($1,$2)',[org,businessIds])).rows:[];
      if(businessIds&&selectedBusinesses.length!==businessIds.length)throw new NotFoundException('One or more businesses are unavailable');
      if(actorRole==='admin' && role==='admin') throw new ForbiddenException('Only an owner can invite another admin');
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`invite:${org}:${requestKey}`]);
      const requestTable=businessContext?'app.business_invitation_requests':'app.idempotency';
      const {rows:[prior]}=await db.query(`SELECT request_hash,response FROM ${requestTable} WHERE organization_id=$1 AND operation='invitation.create' AND key=$2`,[org,requestKey]);
      if(prior) {if(prior.request_hash!==requestHash) throw new ConflictException('This request key was used for different content');return prior.response;}
      const {rows:[count]}=await db.query(`SELECT app.invitation_daily_count() AS count`);
      if(count.count>=100) throw new ConflictException('This client has reached its daily invitation limit');
      // A replacement is authoritative: an older link must not retain a different grant.
      const previous=await db.query(`SELECT id FROM app.invitations WHERE organization_id=$1 AND email=$2 AND status='pending' AND expires_at>now()`,[org,email]);
      for(const pending of previous.rows) await db.query('SELECT app.revoke_invitation($1)',[pending.id]);
      const {rows:[workspace]}=await db.query('SELECT name FROM app.organizations WHERE id=$1',[org]);
      const token=randomBytes(32).toString('base64url'),id=randomUUID(),expires=new Date(Date.now()+7*24*60*60*1000);
      const link=new URL('/accept-invitation',this.origin);link.hash=new URLSearchParams({token}).toString();
      const invitationLabel=businessIds?workspace.name+' — '+selectedBusinesses.map(b=>b.name).join(', ')+' ('+role+')':workspace.name;
      const mailId=await this.mail.enqueue(db,'invite',{to:email,url:link.toString(),workspace:invitationLabel},expires,org,user);
      await db.query(`INSERT INTO app.invitations(id,organization_id,email,role,invited_by,token_hash,expires_at,mail_id,business_ids) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[id,org,email,role,user,digest(token),expires,mailId,businessIds]);
      await db.query(`INSERT INTO app.audit_events(organization_id,actor_id,action,resource_id,brand_id) VALUES($1,$2,'invitation.created',$3,$4)`,[org,user,id,businessContext??null]);
      const result={id,email,role,business_ids:businessIds,status:'pending',email_status:'pending',expires_at:expires.toISOString()};
      if(businessContext)await db.query(`INSERT INTO app.business_invitation_requests(organization_id,brand_id,actor_id,operation,key,request_hash,response) VALUES($1,$2,$3,'invitation.create',$4,$5,$6::jsonb)`,[org,businessContext,user,requestKey,requestHash,JSON.stringify(result)]);
      else await db.query(`INSERT INTO app.idempotency(organization_id,operation,key,request_hash,response) VALUES($1,'invitation.create',$2,$3,$4::jsonb)`,[org,requestKey,requestHash,JSON.stringify(result)]);
      return result;
    },businessContext).catch(teamError);
  }
  private business(user:string,id:string){return new Businesses(this.database,new Workspaces(this.database)).resolve(user,id);}
  async businessList(user:string,id:string){const b=await this.business(user,id);return this.database.transaction(user,b.organization_id,false,async db=>{
    const m=(await db.query('SELECT role,business_scope FROM app.memberships WHERE organization_id=$1 AND user_id=$2 AND active',[b.organization_id,user])).rows[0],canManage=(await db.query('SELECT app.invitation_authorized($1,$2,$3,$4) AS allowed',[b.organization_id,user,[id],'editor'])).rows[0].allowed;
    return {members:(await db.query('SELECT * FROM app.business_team($1)',[id])).rows,can_manage:canManage,can_assign_admin:canManage&&m.business_scope==='all'&&m.role==='owner',can_manage_account:m.business_scope==='all'&&['owner','admin'].includes(m.role),invitations:canManage?(await db.query("SELECT i.id,i.email,i.role,i.business_ids,CASE WHEN i.status='pending' AND i.expires_at<=now() THEN 'expired' ELSE i.status END AS status,i.expires_at,o.status AS email_status FROM app.invitations i JOIN delivery.outbox o ON o.id=i.mail_id WHERE $1=ANY(i.business_ids) ORDER BY i.created_at DESC LIMIT 100",[id])).rows:[],activity:(await db.query("SELECT id,action,resource_id,created_at FROM app.audit_events WHERE brand_id=$1 AND action LIKE 'business.member_%' ORDER BY created_at DESC LIMIT 100",[id])).rows};
  },id);}
  async businessInvite(user:string,id:string,input:unknown,k:unknown){const b=await this.business(user,id),v=object(input,['email','role','business_ids']);const ids=v.business_ids??[id];if(!Array.isArray(ids)||!ids.includes(id))throw new BadRequestException('Include this business in the invitation');return this.invite(user,b.organization_id,{...v,business_ids:ids},k,id);}
  async businessRevoke(user:string,id:string,invitation:string){const b=await this.business(user,id);return this.database.transaction(user,b.organization_id,true,async db=>{
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`members:${b.organization_id}`]);
    if(!(await db.query('SELECT id FROM app.invitations WHERE id=$1 AND $2=ANY(business_ids)',[uuid(invitation),id])).rowCount)throw new NotFoundException('Invitation not found');
    await db.query('SELECT app.revoke_invitation($1)',[invitation]);return {status:'revoked'};
  },id).catch(teamError);}
  async businessChange(user:string,id:string,target:string,input:unknown){const b=await this.business(user,id),v=object(input,['role','active']);if(typeof v.active!=='boolean')throw new BadRequestException('Choose an access status');const role=invitationRole(v.role);return this.database.transaction(user,b.organization_id,true,async db=>{await db.query('SELECT app.change_business_member($1,$2,$3,$4)',[id,uuid(target),role,v.active]);return {user_id:target,role,active:v.active};},id).catch(teamError);}
  accept(user:string,input:unknown) {
    const {token}=object(input,['token']);
    if(typeof token!=='string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new NotFoundException('Invitation unavailable or expired');
    return this.database.transaction(user,undefined,true,async db=>{
      const {rows:[result]}=await db.query('SELECT * FROM app.accept_invitation($1)',[digest(token)]);
      if(!result) throw new NotFoundException('Invitation unavailable or expired');
      return result;
    }).catch(teamError);
  }
  revoke(user:string,organizationId:string,id:string) {
    return this.database.transaction(user,uuid(organizationId),true,async db=>{
      await this.accountScope(db,user,organizationId);await db.query('SELECT app.revoke_invitation($1)',[uuid(id)]);return{status:'revoked'};
    }).catch(teamError);
  }
  change(user:string,organizationId:string,target:string,input:unknown) {
    const value=object(input,['role','active']);
    if(typeof value.role!=='string' || !['owner','admin','editor','viewer'].includes(value.role) || typeof value.active!=='boolean') throw new BadRequestException('A valid role and active status are required');
    return this.database.transaction(user,uuid(organizationId),true,async db=>{
      await this.accountScope(db,user,organizationId);await db.query('SELECT app.change_member($1,$2,$3)',[uuid(target),value.role,value.active]);return{user_id:target,role:value.role,active:value.active};
    }).catch(teamError);
  }
}
