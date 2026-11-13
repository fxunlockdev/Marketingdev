/** Deterministic mock of the Agent Reach CLI's JSON envelope (schema_version 1), for tests and the
 * local stack's mock providers. It never touches the network: every answer is made up from the task. */
import {createHash} from 'node:crypto';
import {ALLOWED_ACTIONS} from './agent-reach-contract.js';

export type MockTask={channel:string;action:string;params:{target?:string;query?:string;limit?:number}};
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const slug=(value:string)=>value.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40)||'business';
const item=(title:string,url:string,text:string,author:string|null=null)=>({title,url,author,published_at:null,text,raw:null});
const envelope=(task:MockTask,backend:string,items:unknown[])=>({schema_version:1,ok:true,channel:task.channel,action:task.action,backend,items,meta:{elapsed_ms:5,attempts:[{backend,result:'ok'}]},error:null});

/** The envelope Agent Reach would print for this task, or its BAD_INPUT refusal. */
export function mockAgentReachEnvelope(task:MockTask):unknown{
 if(!ALLOWED_ACTIONS.some(([c,a])=>c===task.channel&&a===task.action))
  return {schema_version:1,ok:false,channel:task.channel,action:task.action,backend:null,items:[],meta:{elapsed_ms:0,attempts:[]},error:{code:'BAD_INPUT',message:'channel refused',hint:''}};
 if(task.channel==='web'&&task.action==='read'){
  const url=new URL(task.params.target??'https://example.com/'),name=url.hostname.replace(/^www\./,'');
  return envelope(task,'jina',[item(`${name} | Home`,url.href,`# ${name}\n\nMOCK Agent Reach page text for ${url.href}. We make everyday things for people nearby and explain how we work, what we sell and who we serve.\n\nOur customers come back for friendly service and clear prices.\n\n[About us](${url.origin}/about) [Products](${url.origin}/products) [Instagram](https://instagram.com/${slug(name)})`)]);
 }
 const query=task.params.query??'',limit=Math.min(5,Math.max(1,Number(task.params.limit??3)));
 if(task.channel==='web')
  return envelope(task,'exa',Array.from({length:limit},(_,i)=>item(`${query} — result ${i+1}`,`https://${slug(query)}-${i+1}.test/`,`MOCK search snippet ${i+1} about ${query}: what buyers in this market compare, the prices they mention and the words they use.`)));
 if(task.action==='search')
  return envelope(task,'yt-dlp',Array.from({length:limit},(_,i)=>item(`${query} video ${i+1}`,`https://www.youtube.com/watch?v=${digest(query+i).replace(/[^a-zA-Z0-9]/g,'').slice(0,11)}`,`MOCK video description ${i+1} for ${query}: a short tour and customer stories.`,`${query} channel`)));
 if(task.action==='subtitle')return envelope(task,'yt-dlp',[item('Video subtitles',task.params.target??'','MOCK subtitles. Welcome in. Today we show how our customers use what we make, step by step, and answer the questions people ask most.')]);
 return envelope(task,'yt-dlp',[item('Video info',task.params.target??'','MOCK video description.','Channel')]);
}
