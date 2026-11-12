"use client";
import {PostformeAnalytics} from './postforme-analytics';
/** Performance comes from Post for Me, the only publisher. */
export function PostAnalytics({businessId}:{businessId:string}){return <PostformeAnalytics key={businessId} businessId={businessId}/>;}
