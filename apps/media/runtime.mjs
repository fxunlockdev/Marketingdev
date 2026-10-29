import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {registerFont,createCanvas,loadImage} from 'canvas';
import {StaticCanvas,FabricImage,Textbox,Rect} from 'fabric/node';
const sha=b=>createHash('sha256').update(b).digest('hex');
const fonts={
 'DM Sans':{family:'DM Sans',name:'DM Sans',path:'/opt/render/fonts/dm-sans.ttf',weights:[100,200,300,400,500,600,700,800,900]},
 'DM Serif Display':{family:'DM Serif Display',name:'DM Serif Display',path:'/opt/render/fonts/dm-serif-display.ttf',weights:[400,700]},
 'Playfair Display':{family:'Playfair Display',name:'Playfair Display',path:'/opt/render/fonts/playfairdisplay.ttf',weights:[400,500,600,700,800,900]},
 Montserrat:{family:'Montserrat',name:'Montserrat',path:'/opt/render/fonts/montserrat.ttf',weights:[100,200,300,400,500,600,700,800,900]},
 Lora:{family:'Lora',name:'Lora',path:'/opt/render/fonts/lora.ttf',weights:[400,500,600,700]},
 Oswald:{family:'Oswald',name:'Oswald',path:'/opt/render/fonts/oswald.ttf',weights:[200,300,400,500,600,700]},
 Arial:{family:'Desvio Sans',name:'Liberation Sans',path:'/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf',weights:[400,700]},
 Georgia:{family:'Desvio Serif',name:'Liberation Serif',path:'/usr/share/fonts/truetype/liberation2/LiberationSerif-Regular.ttf',weights:[400,700]},
 Verdana:{family:'Desvio Humanist',name:'DejaVu Sans',path:'/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',weights:[400,700]}
};
for(const f of Object.values(fonts)){
 registerFont(f.path,{family:f.family,weight:'400'});
 f.faces={};
 for(const weight of f.weights){
  const path=f.path.replace(/\.ttf$/,`-${weight}.ttf`);
  if(existsSync(path)){registerFont(path,{family:`${f.family} ${weight}`,weight:String(weight)});f.faces[weight]=sha(readFileSync(path));}
 }
 f.sha256=sha(readFileSync(f.path));
}
const manifest={schema_version:1,fabric:'7.4.0',canvas:'3.2.0',jsdom:'26.1.0',node:process.version,platform:process.platform,architecture:process.arch,runtime_sha256:sha(readFileSync(import.meta.filename)),system_packages_sha256:sha(readFileSync('/opt/render/system-packages.txt')),fonts:Object.fromEntries(Object.entries(fonts).map(([k,v])=>[k,{name:v.name,sha256:v.sha256,faces:v.faces}]))};
if(process.argv[2]==='--manifest'){process.stdout.write(JSON.stringify(manifest)+'\n');process.exit(0);}
const fail=code=>{throw new Error(code);};
let c;
try{
 const chunks=[];let n=0;for await(const part of process.stdin){n+=part.length;if(n>29_000_000)fail('EXPORT_INPUT_LIMIT');chunks.push(part);}const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));
 if(input.format!==undefined&&!['png','instagram-jpeg'].includes(input.format))fail('EXPORT_FORMAT_INVALID');
 const d=input.design;if(!d||Object.keys(d).sort().join(',')!=='background_media_id,height,layers,schema_version,width'||d.schema_version!==1||!['1024x1024','1536x1024','1024x1536'].includes(`${d.width}x${d.height}`)||!Array.isArray(d.layers)||d.layers.length>10)fail('EXPORT_DESIGN_INVALID');
 if(typeof input.png!=='string'||input.png.length>28_000_000||! /^[A-Za-z0-9+/]+={0,2}$/.test(input.png))fail('EXPORT_IMAGE_INVALID');const bytes=Buffer.from(input.png,'base64');if(sha(bytes)!==input.media_sha256||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||bytes.readUInt32BE(16)!==d.width||bytes.readUInt32BE(20)!==d.height)fail('EXPORT_IMAGE_INVALID');
 const ids=new Set();for(const l of d.layers){if(!l||Object.keys(l).filter(k=>!['fontWeight','backing'].includes(k)).sort().join(',')!=='align,fill,fontFamily,fontSize,id,text,type,width,x,y'||!/^[-a-z0-9]{1,40}$/.test(l.id)||ids.has(l.id)||(l.fontWeight!==undefined&&!fonts[l.fontFamily]?.weights.includes(l.fontWeight))||(l.backing!==undefined&&(!l.backing||Object.keys(l.backing).sort().join(',')!=='fill,opacity,padding'||!/^#[a-f0-9]{6}$/i.test(l.backing.fill)||!Number.isFinite(l.backing.opacity)||l.backing.opacity<0||l.backing.opacity>1||!Number.isFinite(l.backing.padding)||l.backing.padding<0||l.backing.padding>48||l.x<l.backing.padding||l.y<l.backing.padding||l.x+l.width+l.backing.padding>d.width))||l.type!=='text'||typeof l.text!=='string'||l.text.length>1000||!Object.hasOwn(fonts,l.fontFamily)||!['left','center','right'].includes(l.align)||!/^#[a-f0-9]{6}$/i.test(l.fill)||![l.x,l.y,l.width,l.fontSize].every(Number.isFinite)||l.x<0||l.y<0||l.width<10||l.x+l.width>d.width+1||l.y>d.height||l.fontSize<8||l.fontSize>200)fail('EXPORT_DESIGN_INVALID');ids.add(l.id);}
 c=new StaticCanvas(null,{width:d.width,height:d.height,enableRetinaScaling:false,renderOnAddRemove:false});
 // Decode trusted, validated bytes directly. JSDOM's multi-megabyte data-URL parser
 // can exhaust the sandbox's V8 heap for real generated photographs.
 const image=new FabricImage(await loadImage(bytes));image.set({originX:'left',originY:'top',left:0,top:0});c.backgroundImage=image;
 for(const l of d.layers){const text=new Textbox(l.text,{originX:'left',originY:'top',left:l.x,top:l.y,width:l.width,fontSize:l.fontSize,fontWeight:l.fontWeight??400,fontFamily:fonts[l.fontFamily].faces[l.fontWeight??400]?`${fonts[l.fontFamily].family} ${l.fontWeight??400}`:fonts[l.fontFamily].family,fill:l.fill,textAlign:l.align,splitByGrapheme:!l.backing,strokeWidth:0,padding:4,selectable:false,evented:false});if(l.text.trim()&&l.y+text.height+(l.backing?.padding??0)>d.height)fail('EXPORT_TEXT_OVERFLOW');if(l.text.trim()&&l.backing){const b=l.backing;c.add(new Rect({originX:'left',originY:'top',left:l.x-b.padding,top:l.y-b.padding,width:l.width+2*b.padding,height:text.height+2*b.padding,fill:b.fill,opacity:b.opacity,strokeWidth:0,selectable:false,evented:false}));}c.add(text);}
 c.renderAll();const png=Buffer.from(c.toDataURL({format:'png',multiplier:1,enableRetinaScaling:false}).split(',')[1],'base64');if(png.length>20*1024*1024)fail('EXPORT_OUTPUT_LIMIT');
 if(input.format==='instagram-jpeg'){
  const target=createCanvas(1080,1080),ctx=target.getContext('2d'),scale=Math.min(1080/d.width,1080/d.height),width=Math.round(d.width*scale),height=Math.round(d.height*scale),left=Math.floor((1080-width)/2),top=Math.floor((1080-height)/2);
  ctx.fillStyle='#ffffff';ctx.fillRect(0,0,1080,1080);ctx.drawImage(await loadImage(png),left,top,width,height);
  const jpeg=target.toBuffer('image/jpeg',{quality:0.95,chromaSubsampling:false});if(jpeg.length>8*1024*1024)fail('EXPORT_OUTPUT_LIMIT');
  process.stdout.write(JSON.stringify({jpeg:jpeg.toString('base64'),sha256:sha(jpeg),width:1080,height:1080,manifest:{...manifest,rendition:{version:1,format:'instagram-jpeg',source_sha256:sha(png),fit:'contain',background:'#ffffff',width:1080,height:1080,content:{left,top,width,height}}},warnings:['Instagram preview: artwork fitted without cropping into a white 1080 × 1080 square. Review and approve this JPEG before publishing.']})+'\n');
 }else{
 process.stdout.write(JSON.stringify({png:png.toString('base64'),sha256:sha(png),width:d.width,height:d.height,manifest,warnings:[...new Set(d.layers.filter(l=>l.text.trim()).map(l=>`${l.fontFamily} rendered with ${fonts[l.fontFamily].name}. Review this saved image before final approval.`))]})+'\n');
 }
}catch(e){process.stdout.write(JSON.stringify({error:/^EXPORT_[A-Z_]+$/.test(e.message)?e.message:'EXPORT_RENDER_FAILED'})+'\n');process.exitCode=1;}finally{await c?.dispose();}
