import {GoogleGenAI, type Content, type Part, type GenerateContentParameters} from '@google/genai';
import {canonicalJSON,hash} from './brand-brain.js';
import {CreativeError,type PlannerRequest,type PlannerResponse} from './creative-contracts.js';
function fail():never{throw new CreativeError('SKILL_BROKER_INVALID');}
function parts(value:unknown):Part[]{
 if(!Array.isArray(value)||value.length>16||Buffer.byteLength(JSON.stringify(value))>200000)fail();
 for(const p of value){
  if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(k=>!['text','functionCall','thoughtSignature','thought'].includes(k)))fail();
  if(p.text!==undefined&&typeof p.text!=='string'||p.thought!==undefined&&typeof p.thought!=='boolean'||p.thoughtSignature!==undefined&&(typeof p.thoughtSignature!=='string'||p.thoughtSignature.length>150000))fail();
  if(p.functionCall){const f=p.functionCall;if(f.name!=='read_file'||!f.args||typeof f.args!=='object'||Array.isArray(f.args)||Object.keys(f).some(k=>!['id','name','args'].includes(k))||f.id!==undefined&&(typeof f.id!=='string'||f.id.length>200))fail();}
  if(p.text===undefined&&!p.functionCall&&!p.thoughtSignature)fail();
 }
 return value;
}
export class GeminiPlanner {
 readonly sdk?:GoogleGenAI;
 constructor(key?:string,sdk?:GoogleGenAI){this.sdk=sdk??(key?new GoogleGenAI({apiKey:key,vertexai:false,httpOptions:{apiVersion:'v1beta',timeout:120000,retryOptions:{attempts:1}}}):undefined);}
 get configured(){return !!this.sdk;}
 plannerRequest(request:PlannerRequest,model:string,maxOutputTokens:4000|16000=16000){
  if(!/^gemini-[a-zA-Z0-9._-]{1,90}$/.test(model)||!Number.isInteger(request.step)||request.step<1||request.step>3||!request.messages.length||request.messages.length>30||request.tools.length>1||request.tools.some(t=>t?.type!=='function'||t.function?.name!=='read_file'))fail();
  const contents:Content[]=[],system:string[]=[],calls=new Map<string,{name:string;id?:string}>();
  for(const m of request.messages){
   if(typeof m.content!=='string')fail();
   if(m.role==='system'){system.push(m.content);continue;}
   if(m.role==='user'){contents.push({role:'user',parts:[{text:m.content}]});continue;}
   if(m.role==='assistant'){
    if(m.provider_context?.provider!=='gemini')fail();
    const raw=parts(m.provider_context.parts),functions=raw.filter(p=>p.functionCall).map(p=>p.functionCall!);
    if(functions.length!==(m.tool_calls?.length??0)||m.content!==raw.filter(p=>!p.thought&&p.text!==undefined).map(p=>p.text).join(''))fail();
    for(const [i,f] of functions.entries()){
     const call=m.tool_calls![i];if(call.name!==f.name||canonicalJSON(call.args)!==canonicalJSON(f.args)||typeof call.id!=='string'||call.id.length>200||calls.has(call.id))fail();
     calls.set(call.id,{name:f.name!,...(f.id?{id:f.id}:{})});
    }
    // Preserve signed parts verbatim, including their order and opaque signatures.
    contents.push({role:'model',parts:raw});continue;
   }
   if(m.role==='tool'){
    const call=calls.get(m.tool_call_id??'');if(!call)fail();calls.delete(m.tool_call_id!);
    const part:Part={functionResponse:{...call,response:{result:m.content}}},previous=contents.at(-1);
    if(previous?.role==='user'&&previous.parts?.every(p=>p.functionResponse))previous.parts.push(part);else contents.push({role:'user',parts:[part]});
    continue;
   }
   fail();
  }
  if(calls.size)fail();
  const body:GenerateContentParameters={model,contents,config:{systemInstruction:system.join('\n\n'),maxOutputTokens,candidateCount:1,thinkingConfig:{includeThoughts:false},automaticFunctionCalling:{disable:true},...(request.tools.length?{tools:[{functionDeclarations:request.tools.map(t=>({name:'read_file',description:t.function.description,parametersJsonSchema:t.function.parameters}))}]}:{})}};
  const size=Buffer.byteLength(canonicalJSON(body));if(size>400000)throw new CreativeError('SKILL_INPUT_LIMIT');
  return {body,sha256:hash(canonicalJSON({provider:'gemini',...body})),maxInputTokens:size+2048,maxOutputTokens};
 }
 async plan(request:PlannerRequest,model:string,maxOutputTokens:4000|16000=16000):Promise<PlannerResponse>{
  if(!this.sdk)throw new CreativeError('PLAN_PROVIDER_NOT_CONFIGURED');
  const response=await this.sdk.models.generateContent(this.plannerRequest(request,model,maxOutputTokens).body);
  const candidate=response.candidates?.[0];
  if(response.candidates?.length!==1||candidate?.finishReason!=='STOP'||!candidate.content?.parts)throw new CreativeError('CREATIVE_PLAN_REJECTED');
  const raw=parts(candidate.content.parts),functions=raw.filter(p=>p.functionCall).map(p=>p.functionCall!);
  if(functions.length>4)throw new CreativeError('SKILL_RESPONSE_INVALID');
  return {content:raw.filter(p=>!p.thought&&p.text!==undefined).map(p=>p.text).join(''),tool_calls:functions.map((f,i)=>({id:f.id??`gemini-${request.step}-${i}`,name:f.name!,args:structuredClone(f.args!)})),provider_context:{provider:'gemini',parts:raw},response_id:response.responseId,usage:response.usageMetadata};
 }
}
