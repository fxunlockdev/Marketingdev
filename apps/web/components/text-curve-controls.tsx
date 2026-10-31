"use client";
import {useId} from 'react';
import type {Design} from '../../api/src/creative-design';
type Layer=Design['layers'][number];
export function TextCurveControls({layer,update}:{layer:Layer;update:(value:Partial<Layer>)=>void}){
 const id=useId(),curved=!!layer.curvature;
 return <div className="text-curve-controls">
  <div className="field"><span className="chat-field-label">Text shape</span><div className="chat-layer-segments" role="group" aria-label="Text shape">
   <button type="button" aria-pressed={!curved} onClick={()=>update({curvature:0})}>Straight</button>
   <button type="button" aria-pressed={curved} onClick={()=>update({curvature:layer.curvature||50})}>Curve</button>
  </div></div>
  {<div className="field"><label htmlFor={id}>Bend <output>{layer.curvature??0}</output></label>
   <input id={id} type="range" min={-100} max={100} step={1} value={layer.curvature??0} onChange={e=>update({curvature:Number(e.target.value)})}/>
   <p className="hint">Bend up or down. Choose Straight to reset.</p>
  </div>}
 </div>;
}
