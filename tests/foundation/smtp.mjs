import { SMTPServer } from 'smtp-server';
import { simpleParser } from 'mailparser';

export async function startMailbox() {
  const messages=[];let behavior='accept';
  const server=new SMTPServer({disabledCommands:['AUTH','STARTTLS'],authOptional:true,logger:false,disableReverseLookup:true,size:65536,
    onData(stream,_session,callback) {
      const chunks=[];stream.on('data',chunk=>chunks.push(chunk));
      stream.on('end',async()=>{
        const message=await simpleParser(Buffer.concat(chunks));
        if(behavior==='temporary' || behavior==='permanent') {const error=new Error('Local test rejection');error.responseCode=behavior==='temporary'?450:550;callback(error);return;}
        messages.push(message);
        if(behavior==='drop-after-data') {
          // Pinned smtp-server exposes its connections Set and close(): simulate lost DATA acknowledgement.
          for(const connection of server.connections) connection.close();
          return;
        }
        callback();
      });
    }});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return{messages,port:server.server.address().port,setBehavior(value){behavior=value;},close:()=>new Promise(resolve=>server.close(resolve))};
}
export function messageLink(message) {
  const found=message?.text?.match(/https?:\/\/[^\s]+/);
  if(!found) throw new Error('Test email did not contain a link');
  return new URL(found[0]);
}
