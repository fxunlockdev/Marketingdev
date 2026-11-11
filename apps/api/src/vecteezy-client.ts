/** Server-only Vecteezy v2 adapter. URLs are ephemeral and must not be persisted.
 * Download consumes quota, even though the vendor uses GET. Never auto-retry it.
 */
export class StockError extends Error {
  constructor(readonly code:string){super(code);this.name='StockError';}
}
export type StockPhoto={id:number;title:string;previewURL:string|null;aiGenerated:boolean|null};
export type StockDownload={url:string;requiresAttribution:boolean;attributionURL:string|null};
const validId=(n:number)=>Number.isSafeInteger(n)&&n>0;
function httpsURL(value:unknown):string{
  if(typeof value!=='string')throw new StockError('STOCK_RESPONSE_INVALID');
  try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password)throw new Error();return u.href;}
  catch{throw new StockError('STOCK_RESPONSE_INVALID');}
}
export class VecteezyClient {
  constructor(private readonly key:string|undefined,private readonly accountId:number,private readonly transport:typeof fetch=fetch){}
  get configured(){return !!this.key&&!/[\r\n]/.test(this.key)&&validId(this.accountId);}
  private async get(path:string,download=false):Promise<any>{
    if(!this.configured)throw new StockError('STOCK_NOT_CONFIGURED');
    try{
      const r=await this.transport(`https://api.vecteezy.com/v2/${this.accountId}/${path}`,{headers:{Authorization:`Bearer ${this.key}`,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(20000)});
      if(!r.ok){
        await r.body?.cancel().catch(()=>{});
        throw new StockError(download&&r.status>=500?'STOCK_DOWNLOAD_UNKNOWN':({401:'STOCK_AUTH_FAILED',402:'STOCK_QUOTA_EXCEEDED',403:'STOCK_ACCESS_DENIED',404:'STOCK_NOT_FOUND',429:'STOCK_RATE_LIMITED'} as Record<number,string>)[r.status]??'STOCK_REQUEST_FAILED');
      }
      const reader=r.body?.getReader();if(!reader)throw new StockError('STOCK_RESPONSE_INVALID');
      let size=0;const chunks:Uint8Array[]=[];
      try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>2*1024*1024)throw new StockError('STOCK_RESPONSE_INVALID');chunks.push(part.value);}}
      finally{await reader.cancel().catch(()=>{});}
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    }catch(e){
      if(e instanceof StockError){if(download&&e.code==='STOCK_RESPONSE_INVALID')throw new StockError('STOCK_DOWNLOAD_UNKNOWN');throw e;}
      throw new StockError(download?'STOCK_DOWNLOAD_UNKNOWN':'STOCK_UNAVAILABLE');
    }
  }
  async search(term:string,orientation:'horizontal'|'vertical'|'square'='square'):Promise<StockPhoto[]>{
    if(!term.trim()||term.length>500||!['horizontal','vertical','square'].includes(orientation))throw new StockError('STOCK_QUERY_INVALID');
    const q=new URLSearchParams({term:term.trim(),content_type:'photo',license_type:'commercial',ai_generated:'false',family_friendly:'true',orientation,per_page:'12',page:'1',sort_by:'relevance'});
    const data=await this.get(`resources?${q}`);
    if(!Array.isArray(data?.resources)||data.resources.length>12)throw new StockError('STOCK_RESPONSE_INVALID');
    return data.resources.map((r:any)=>{
      if(!validId(r?.id)||r.content_type!=='photo'||r.ai_generated===true)throw new StockError('STOCK_RESPONSE_INVALID');
      return {id:r.id,title:typeof r.title==='string'?r.title.slice(0,500):'',previewURL:r.preview_url==null?null:httpsURL(r.preview_url),aiGenerated:typeof r.ai_generated==='boolean'?r.ai_generated:null};
    });
  }
  async download(resourceId:number):Promise<StockDownload>{
    if(!validId(resourceId))throw new StockError('STOCK_RESOURCE_INVALID');
    const data=await this.get(`resources/${resourceId}/download?file_type=jpg&file_size=original`,true);
    try{
      if(typeof data?.requires_attribution!=='boolean')throw new StockError('STOCK_RESPONSE_INVALID');
      const attributionURL=data.required_attribution_url==null?null:httpsURL(data.required_attribution_url);
      if(data.requires_attribution&&!attributionURL)throw new StockError('STOCK_RESPONSE_INVALID');
      return {url:httpsURL(data.url),requiresAttribution:data.requires_attribution,attributionURL};
    }catch{throw new StockError('STOCK_DOWNLOAD_UNKNOWN');}
  }
}
