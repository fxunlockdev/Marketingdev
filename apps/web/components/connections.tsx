"use client";
import {useEffect,useState} from 'react';
import './media-connections-refinement.css';
import {PostformeConnections} from './postforme-connections';
import {Wordmark} from './primitives';
type Business={id:string;name:string};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
/** Landing page for an old provider return link. Connections are now made through Post for Me. */
export function SocialCallbackResult(){
 const [result,setResult]=useState<{reason:string;business:string;attempt:string}>();useEffect(()=>{const q=new URLSearchParams(location.search);setResult({reason:q.get('reason')??'invalid',business:q.get('business')??'',attempt:q.get('attempt')??''});},[]);
 const messages:Record<string,string>={session:'Your Desvio session ended. Sign in and start a new connection from your business.',access:'This connection does not belong to this login, or your access changed. Return to your business and start again.',expired:'This connection link expired or its settings changed. Return to your business and start again.',invalid:'We couldn’t recognize this connection return. Start a new connection from Desvio.',unconfirmed:'We couldn’t confirm that your connection return was saved. Check the business’s connection status before starting again.'};
 return <main id="main" className="standalone"><Wordmark/><p className="eyebrow">Social connection</p><h1>Let’s check your connection.</h1><p role="status">{result?messages[result.reason]??messages.invalid:'Checking the connection return…'}</p><div className="connection-result-actions">{result?.reason==='session'&&<a className="button primary" href="/sign-in">Sign in</a>}{result&&uuid.test(result.business)&&<a className="button" href={`/b/${result.business}/connections${uuid.test(result.attempt)?'?attempt='+result.attempt:''}`}>Back to connections</a>}<a href="/brands">Your businesses</a></div></main>;
}

/** Post for Me is the only social provider. */
export function ConnectionsScreen({business}:{business:Business}){return <PostformeConnections key={business.id} business={business}/>;}
