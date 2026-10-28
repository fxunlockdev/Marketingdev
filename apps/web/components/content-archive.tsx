"use client";
import {useCallback,useEffect,useRef,useState} from 'react';
import {api} from './api';
import {Loading,Notice} from './primitives';
import {AppLink} from './app-link';
import {PostThumbnail} from './post-thumbnail';
import {CreativeProject} from './canvas';
import {ArchivedMultimedia} from './archived-multimedia';
export function ContentArchive({business}:{business:{id:string;role:string;organization_id:string;name:string;has_approved_brand:boolean}}){
 const [page,setPage]=useState(1),[data,setData]=useState<any>(),[error,setError]=useState<unknown>(),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const [tab,setTab]=useState("posts"),[selected,setSelected]=useState(""),[historyDirty,setHistoryDirty]=useState(false);
 const request=useRef(0);
 const root=`/api/v1/businesses/${business.id}`,canWrite=['owner','admin','editor'].includes(business.role);
 const load=useCallback(async()=>{const sequence=++request.current;setData(undefined);try{setError(undefined);const result=await api(`${root}/${tab==='posts'?'content-archive':'creative-project-archive'}?page=${page}`);if(sequence===request.current)setData(result);}catch(e){if(sequence===request.current)setError(e);}},[root,page,tab]);
 useEffect(()=>{void load();return()=>{request.current++;};},[load]);
 async function restore(entry:any){setBusy(true);setError(undefined);try{await api(`${root}/content-slots/${entry.id}/restore`,{revision:entry.revision});setMessage('Post restored as a draft. Review it before publishing.');await load();}catch(e){setError(e);}finally{setBusy(false);}}
 return <section className="content-archive" aria-label="Archived posts"><header className="section-heading"><div><h1>Archived posts</h1><p>Removed posts and saved creatives, with their saved version history.</p></div><AppLink className="button" href={`/b/${business.id}/content-plan`}>Open calendar</AppLink></header>
 <div className="actions" aria-label="Archive type"><button aria-pressed={tab==='posts'} onClick={()=>{if(historyDirty&&!confirm("Discard unsaved creative edits?"))return;setTab("posts");setPage(1);setSelected("");}}>Calendar posts</button><button aria-pressed={tab==='creatives'} onClick={()=>{if(historyDirty&&!confirm("Discard unsaved creative edits?"))return;setTab("creatives");setPage(1);setSelected("");}}>saved creatives</button></div>
 {error&&<><Notice error={error}/><button onClick={()=>void load()}>Try again</button></>}{message&&<p role="status">{message}</p>}{!data&&!error&&<Loading/>}
 {data?.entries?.length===0&&<div className="archive-empty"><h2>No archived posts yet</h2><p>Your previous versions and removed posts will appear here.</p></div>}
 <ul className="campaign-preview-grid">{data?.entries?.map((entry:any)=><li key={entry.entry_id}><div className="campaign-card-top"><span>{entry.channel}</span><span>{entry.kind==='archived'?'Archived':'Previous version'}</span></div><PostThumbnail businessId={business.id} post={entry}/><div className="campaign-card-body"><h2 className="post-topic-summary">{entry.hook||entry.brief}</h2><p className="hint">{entry.plan_title} · {new Date(entry.archived_at).toLocaleDateString()}</p><div className="actions"><AppLink className="button" href={`/b/${business.id}/content-plan?slot=${entry.id}`}>View post history</AppLink>{entry.kind==='archived'&&canWrite&&<button disabled={busy} onClick={()=>void restore(entry)}>Restore draft</button>}</div></div></li>)}</ul>
 {data?.projects?.length===0&&<div className="archive-empty"><h2>No archived saved creatives</h2><p>Archive an image, video or carousel from its campaign editor to keep it here with its version history.</p></div>}
 <ul className="campaign-preview-grid">{data?.projects?.map((project:any)=><li key={project.id}><PostThumbnail businessId={business.id} post={project}/><div className="campaign-card-body"><h2 className="post-topic-summary">{project.title}</h2><p className="hint">{project.kind}</p><p className="hint">{project.version_count} saved versions · {new Date(project.archived_at).toLocaleDateString()}</p><button aria-expanded={selected===project.id} onClick={()=>{if(historyDirty&&!confirm('Discard unsaved creative edits?'))return;setSelected(selected===project.id?'':project.id);}}>View creative & history</button></div></li>)}</ul>
 {tab==='creatives'&&selected&&<section aria-label="Archived creative history"><button onClick={()=>{if(historyDirty&&!confirm('Discard unsaved creative edits?'))return;setSelected('');void load();}}>Close history</button>{data?.projects?.find((p:any)=>p.id===selected)?.kind==='image'?<CreativeProject key={selected} business={business} projectId={selected} onDirty={setHistoryDirty}/>:data?.projects?.find((p:any)=>p.id===selected)&&<ArchivedMultimedia key={selected} business={business} project={data.projects.find((p:any)=>p.id===selected)} onRestored={async()=>{setSelected('');await load();}}/>}</section>}
 {data&&(page>1||data.has_more)&&<nav aria-label="Archive pages" className="actions"><button disabled={page===1||busy} onClick={()=>{if(historyDirty&&!confirm("Discard unsaved creative edits?"))return;setSelected("");setPage(p=>p-1);}}>Previous</button><span>Page {page}</span><button disabled={!data.has_more||busy} onClick={()=>{if(historyDirty&&!confirm("Discard unsaved creative edits?"))return;setSelected("");setPage(p=>p+1);}}>Next</button></nav>}
 </section>;
}
