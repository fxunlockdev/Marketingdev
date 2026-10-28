"use client";
import {useRef} from 'react';
import {AppLink} from './app-link';
export function CreateNew({businessId}:{businessId:string}){
 const dialog=useRef<HTMLDialogElement>(null);
 return <><button className="primary" onClick={()=>dialog.current?.showModal()}>＋ Create new</button><dialog ref={dialog} className="create-new-dialog" aria-labelledby="create-new-title"><header><h2 id="create-new-title">Create new</h2><button type="button" aria-label="Close create menu" onClick={()=>dialog.current?.close()}>×</button></header><nav aria-label="What would you like to create?">{[
 ['campaigns?post=new','Post','Add an image, carousel, video, story or blog to a campaign.','✧'],['campaign-new','Campaign','A themed set of posts over a date range.','▦'],['strategies','Add strategy','Group weekly campaigns around a goal.','◇']
 ].map(([path,title,description,icon])=><AppLink key={path} href={`/b/${businessId}/${path}`} onClick={()=>dialog.current?.close()}><span aria-hidden="true">{icon}</span><div><strong>{title}</strong><p>{description}</p></div><span aria-hidden="true">→</span></AppLink>)}</nav></dialog></>;
}
