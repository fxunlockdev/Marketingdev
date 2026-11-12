// Local SMTP sink: accepts every message on 127.0.0.1, never relays, and records the
// subject and first link so sign-up verification and password resets work locally.
import {SMTPServer} from 'smtp-server';
import {simpleParser} from 'mailparser';
import {appendFileSync,readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {PATHS} from './config.mjs';

export const MAILBOX=join(PATHS.mail,'messages.jsonl');

export async function startMailSink(port,log=()=>{}){
 const server=new SMTPServer({disabledCommands:['AUTH','STARTTLS'],authOptional:true,logger:false,disableReverseLookup:true,size:262144,
  onData(stream,_session,callback){
   const chunks=[];
   stream.on('data',c=>chunks.push(c));
   stream.on('end',async()=>{
    try{
     const parsed=await simpleParser(Buffer.concat(chunks));
     const entry={at:new Date().toISOString(),to:parsed.to?.value?.map(v=>v.address).join(', ')??'',subject:parsed.subject??'',link:parsed.text?.match(/https?:\/\/\S+/)?.[0]??null};
     appendFileSync(MAILBOX,JSON.stringify(entry)+'\n',{mode:0o600});
     log(`mail: "${entry.subject}" to ${entry.to}${entry.link?`\n      open: ${entry.link}`:''}`);
     callback();
    }catch(error){callback(error);}
   });
  }});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
 return {close:()=>new Promise(resolve=>server.close(resolve))};
}

export function mailbox(){
 if(!existsSync(MAILBOX))return [];
 return readFileSync(MAILBOX,'utf8').split('\n').filter(Boolean).map(line=>JSON.parse(line));
}
