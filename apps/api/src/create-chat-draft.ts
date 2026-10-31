import {BadRequestException} from '@nestjs/common';
import {object} from './workspaces.js';
/** A draft is untrusted author input. Never use it as approved facts or a job authorization. */
export function parseCreateDraft(body:unknown){
 const v=object(body,['revision','snapshot']);
 if(!Number.isSafeInteger(v.revision)||Number(v.revision)<0)throw new BadRequestException('Invalid draft revision');
 if(!v.snapshot||typeof v.snapshot!=='object'||Array.isArray(v.snapshot))throw new BadRequestException('Invalid draft');
 const s=v.snapshot as Record<string,unknown>;
 if(s.version!==1||!['post','campaign','strategy',null].includes(s.mode as any)||!Number.isSafeInteger(s.step)||Number(s.step)<0||Number(s.step)>40||!Array.isArray(s.messages)||s.messages.length>150)throw new BadRequestException('Invalid draft');
 if(Object.keys(s).some(k=>!['version','mode','step','data','messages','request','result','thread','planId','composer'].includes(k)))throw new BadRequestException('Invalid draft fields');
 if(!s.data||typeof s.data!=='object'||Array.isArray(s.data)||Object.entries(s.data).some(([k,v])=>k.length>40||typeof v!=='string'||v.length>2048))throw new BadRequestException('Invalid draft answers');
 if(s.composer!==undefined&&(typeof s.composer!=='string'||s.composer.length>8000))throw new BadRequestException('Invalid draft message');
 for(const field of ['thread','planId'])if(s[field]!==undefined&&(typeof s[field]!=='string'||!/^[0-9a-f-]{36}$/i.test(s[field] as string)))throw new BadRequestException('Invalid draft reference');
 if(s.request!==undefined){const r=s.request as any;if(!r||typeof r!=='object'||typeof r.key!=='string'||!/^[A-Za-z0-9_.:-]{8,128}$/.test(r.key)||typeof r.path!=='string'||!/^\/api\/v1\/businesses\/[0-9a-f-]{36}\/(content-plan\/generate|content-plans\/[0-9a-f-]{36}\/posts|strategies)$/.test(r.path)||!r.body||typeof r.body!=='object'||Array.isArray(r.body))throw new BadRequestException('Invalid saved creation request');}
 if(s.messages.some((m:any)=>!m||!['user','assistant'].includes(m.role)||typeof m.text!=='string'||m.text.length>8000))throw new BadRequestException('Invalid draft messages');
 if(Buffer.byteLength(JSON.stringify(s),'utf8')>100000)throw new BadRequestException('This conversation is too long. Save your work and start a new one.');
 return {revision:Number(v.revision),snapshot:s};
}
