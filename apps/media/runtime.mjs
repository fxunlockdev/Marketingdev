import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {registerFont} from 'canvas';
import {StaticCanvas,FabricImage,Textbox} from 'fabric/node';
const sha=b=>createHash('sha256').update(b).digest('hex');
const fonts={Arial:{family:'Desvio Sans',name:'Liberation Sans',path:'/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf'},Georgia:{family:'Desvio Serif',name:'Liberation Serif',path:'/usr/share/fonts/truetype/liberation2/LiberationSerif-Regular.ttf'},Verdana:{family:'Desvio Humanist',name:'DejaVu Sans',path:'/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'}};
for(const f of Object.values(fonts)){registerFont(f.path,{family:f.family});f.sha256=sha(readFileSync(f.path));}
const manifest={schema_version:1,fabric:'7.4.0',canvas:'3.2.0',jsdom:'26.1.0',node:process.version,platform:process.platform,architecture:process.arch,runtime_sha256:sha(readFileSync(import.meta.filename)),system_packages_sha256:sha(readFileSync('/opt/render/system-packages.txt')),fonts:Object.fromEntries(Object.entries(fonts).map(([k,v])=>[k,{name:v.name,sha256:v.sha256}]))};
if(process.argv[2]==='--manifest'){process.stdout.write(JSON.stringify(manifest)+'\n');process.exit(0);}
const fail=code=>{throw new Error(code);};
let c;
try{
 const chunks=[];let n=0;for await(const part of process.stdin){n+=part.length;if(n>29_000_000)fail('EXPORT_INPUT_LIMIT');chunks.push(part);}const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));
 const d=input.design;if(!d||Object.keys(d).sort().join(',')!=='background_media_id,height,layers,schema_version,width'||d.schema_version!==1||!['1024x1024','1536x1024','1024x1536'].includes(`${d.width}x${d.height}`)||!Array.isArray(d.layers)||d.layers.length>10)fail('EXPORT_DESIGN_INVALID');
 if(typeof input.png!=='string'||input.png.length>28_000_000||! /^[A-Za-z0-9+/]+={0,2}$/.test(input.png))fail('EXPORT_IMAGE_INVALID');const bytes=Buffer.from(input.png,'base64');if(sha(bytes)!==input.media_sha256||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||bytes.readUInt32BE(16)!==d.width||bytes.readUInt32BE(20)!==d.height)fail('EXPORT_IMAGE_INVALID');
 const ids=new Set();for(const l of d.layers){if(!l||Object.keys(l).sort().join(',')!=='align,fill,fontFamily,fontSize,id,text,type,width,x,y'||!/^[-a-z0-9]{1,40}$/.test(l.id)||ids.has(l.id)||l.type!=='text'||typeof l.text!=='string'||l.text.length>1000||!Object.hasOwn(fonts,l.fontFamily)||!['left','center','right'].includes(l.align)||!/^#[a-f0-9]{6}$/i.test(l.fill)||![l.x,l.y,l.width,l.fontSize].every(Number.isFinite)||l.x<0||l.y<0||l.width<10||l.x+l.width>d.width+1||l.y>d.height||l.fontSize<8||l.fontSize>200)fail('EXPORT_DESIGN_INVALID');ids.add(l.id);}
 c=new StaticCanvas(null,{width:d.width,height:d.height,enableRetinaScaling:false,renderOnAddRemove:false});
 const image=await FabricImage.fromURL('data:image/png;base64,'+bytes.toString('base64'));image.set({originX:'left',originY:'top',left:0,top:0});c.backgroundImage=image;
 for(const l of d.layers){const text=new Textbox(l.text,{originX:'left',originY:'top',left:l.x,top:l.y,width:l.width,fontSize:l.fontSize,fontFamily:fonts[l.fontFamily].family,fill:l.fill,textAlign:l.align,splitByGrapheme:true,strokeWidth:0,padding:4,selectable:false,evented:false});if(l.text.trim()&&l.y+text.height>d.height)fail('EXPORT_TEXT_OVERFLOW');c.add(text);}
 c.renderAll();const png=Buffer.from(c.toDataURL({format:'png',multiplier:1,enableRetinaScaling:false}).split(',')[1],'base64');if(png.length>20*1024*1024)fail('EXPORT_OUTPUT_LIMIT');
 process.stdout.write(JSON.stringify({png:png.toString('base64'),sha256:sha(png),width:d.width,height:d.height,manifest,warnings:[...new Set(d.layers.filter(l=>l.text.trim()).map(l=>`${l.fontFamily} rendered with ${fonts[l.fontFamily].name}. Review this saved image before final approval.`))]})+'\n');
}catch(e){process.stdout.write(JSON.stringify({error:/^EXPORT_[A-Z_]+$/.test(e.message)?e.message:'EXPORT_RENDER_FAILED'})+'\n');process.exitCode=1;}finally{await c?.dispose();}
