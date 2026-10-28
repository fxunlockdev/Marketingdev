import {createInterface} from 'node:readline';
import {chromium} from 'playwright';
const VERSION='website-renderer-v1';
/** Fixed child program. No filesystem reads, credentials or direct network. */
export async function capture(browser,url,request){
 const origin=new URL(url),context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block',acceptDownloads:false,javaScriptEnabled:true});
 const pages=[],failures=[];let id=0;const beganCapture=Date.now();
 try{
  await context.routeWebSocket('**/*',socket=>socket.close());
  await context.route('**/*',async route=>{
   const r=route.request();
   try{
    if(++id>80||r.method()!=='GET'||!/^https?:\/\//i.test(r.url()))return route.abort();
    const reply=await request({id,url:r.url(),method:r.method(),resourceType:r.resourceType()});
    if(reply.error)return route.abort();
    await route.fulfill({status:reply.status,headers:reply.headers,body:Buffer.from(reply.body,'base64')});
   }catch{await route.abort().catch(()=>{});}
  });
  const queue=[url];
  for(let index=0;index<queue.length&&index<3;index++){
   if(Date.now()-beganCapture>38000)break;
   const fail=code=>failures.push({page:index,code});let phase='NAVIGATION';
   // A failed navigation must never reuse the preceding page's evidence.
   const page=await context.newPage(),session=await context.newCDPSession(page);
   page.on('popup',popup=>popup.close().catch(()=>{}));
   page.on('download',download=>download.cancel());
   page.on('dialog',dialog=>dialog.dismiss());
   try{
    await session.send('Network.enable');
    const mainFrame=(await session.send('Page.getFrameTree')).frameTree.frame.id;
    const documents=new Map();
    session.on('Network.responseReceived',event=>{
     if(event.type==='Document'&&event.frameId===mainFrame&&event.response.status>=200&&event.response.status<300)documents.set(event.response.url,event.loaderId);
    });
    const began=Date.now(),navigationBudget=Math.min(12000,Math.max(1,45000-(began-beganCapture)-6500));
    const response=await page.goto(queue[index],{waitUntil:'commit',timeout:navigationBudget});
    if(!response||!response.ok()){fail('DOCUMENT_UNAVAILABLE');continue;}
    const loader=documents.get(response.url());
    if(!loader){fail('DOCUMENT_PROVENANCE_MISSING');continue;}
    phase='DOM_CAPTURE';
    const sameDocument=async()=>(await session.send('Page.getFrameTree')).frameTree.frame.loaderId===loader;
    // Slow deferred scripts/styles must not erase usable committed evidence.
    // The total navigation wait remains twelve seconds, including commit.
    try{await page.waitForLoadState('domcontentloaded',{timeout:Math.max(1,navigationBudget-(Date.now()-began))});}
    catch(error){if(error?.name!=='TimeoutError')throw error;fail('DOM_LOAD_TIMEOUT');}
    if(!await sameDocument()){fail('DOCUMENT_CHANGED');continue;}
    // Bound hydration/lazy media settling; never wait forever for analytics.
    await page.waitForTimeout(1200);
    await page.evaluate(()=>window.scrollTo(0,Math.min(document.body.scrollHeight,1400)));
    await page.waitForTimeout(300);await page.evaluate(()=>window.scrollTo(0,0));
    const result=await page.evaluate(()=>{
     const text=(document.querySelector('main')??document.body)?.innerText?.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').slice(0,24000)??'';
     const images=[...document.images].filter(i=>i.naturalWidth>=240&&i.naturalHeight>=160).slice(0,24).map(i=>({url:i.currentSrc||i.src,label:i.alt.slice(0,140)}));
     for(const el of [...document.querySelectorAll('main *,header *,section')].slice(0,400)){
      const background=getComputedStyle(el).backgroundImage;
      for(const match of background.matchAll(/url\(["']?([^"')]+)["']?\)/g))if(images.length<24)images.push({url:match[1],label:'Website image'});
     }
     return {url:location.href,title:document.title.slice(0,300),text,images,links:[...document.querySelectorAll('a[href]')].map(a=>a.href).filter(h=>h.length<2048).slice(0,80)};
    });
    // Keep evidence tied to the robots-checked fetched document, not an
    // arbitrary URL injected by client-side history.replaceState.
    result.url=response.url();
    if(result.text.trim().length<160){fail('INSUFFICIENT_TEXT');continue;}
    if(!await sameDocument()){fail('DOCUMENT_CHANGED');continue;}
    phase='SCREENSHOT';
    // Capture the actual viewport without waiting for webfonts or analytics.
    // A fixed CDP method does not grant the child any additional network access.
    let screenshotTimer;
    try{
     const screenshot=await Promise.race([session.send('Page.captureScreenshot',{format:'jpeg',quality:70,captureBeyondViewport:false}),new Promise((_,reject)=>{screenshotTimer=setTimeout(()=>reject(Object.assign(new Error('Screenshot deadline'),{name:'TimeoutError'})),4000);})]);
     result.screenshot=screenshot.data;
    }catch(error){
     // Screenshot failure must not discard independently verified DOM/photos.
     fail(`SCREENSHOT_${error?.name==='TimeoutError'?'TIMEOUT':'FAILED'}`);
    }finally{clearTimeout(screenshotTimer);}
    if(!await sameDocument()){fail('DOCUMENT_CHANGED');continue;}
    pages.push(result);
    for(const link of result.links){try{const u=new URL(link);u.hash='';if(u.hostname.replace(/^www\./,'')===origin.hostname.replace(/^www\./,'')&&!u.search&&/about|product|service|project/i.test(u.pathname)&&!queue.includes(u.href)&&queue.length<3)queue.push(u.href);}catch{}}
   }catch(error){fail(`${phase}_${error?.name==='TimeoutError'?'TIMEOUT':'FAILED'}`);/* Keep independently usable pages. */}
   finally{await session.detach().catch(()=>{});await page.close().catch(()=>{});}
  }
  return {version:VERSION,pages,failures};
 }finally{await context.close();}
}
async function main(){
 const lines=createInterface({input:process.stdin,crlfDelay:Infinity});let started=false;const pending=new Map();
 let browser;const write=value=>process.stdout.write(JSON.stringify(value)+'\n');
 lines.on('line',async line=>{
  if(line.length>6*1024*1024)return process.exit(1);
  let message;try{message=JSON.parse(line);}catch{return process.exit(1);}
  if(started){const resolve=pending.get(message.id);if(resolve){pending.delete(message.id);resolve(message);}return;}
  started=true;
  try{
   if(typeof message.url!=='string'||message.url.length>2048)throw new Error();
   browser=await chromium.launch({headless:true,args:['--disable-background-networking','--disable-component-update','--disable-sync','--disable-extensions','--no-first-run','--disable-dev-shm-usage']});
   const result=await capture(browser,message.url,r=>new Promise(resolve=>{pending.set(r.id,resolve);write({type:'request',...r});}));
   write({type:'result',...result});
  }catch{write({type:'error',error:'WEBSITE_RENDER_FAILED'});}
  finally{await browser?.close();lines.close();process.exit(0);}
 });
 setTimeout(()=>process.exit(1),45000).unref();
}
if(process.argv[1]?.endsWith('/runtime.mjs'))await main();
