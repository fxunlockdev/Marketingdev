"use client";
import {paintCurvedText} from '../lib/curved-text.mjs';
import {TextCurveControls} from './text-curve-controls';
import {ChatLayerControls} from './chat-layer-controls';
import type {ReactNode,CSSProperties} from 'react';
import {readableDesign} from '../../api/src/creative-design';
import { useEffect, useRef, useState } from "react";
import { Canvas, FabricImage, Textbox, Rect } from "fabric";
import type { Design } from "../../api/src/creative-design";
import { DESIGN_FONT_FAMILIES, designFontWeights, type FontWeight } from "../../api/src/brand-typography";
import { loadDesignFonts } from "./design-font-loader";
import { loadPrivateImage } from "./load-private-image";
import { Field, Notice } from "./primitives";
export type { Design };

// Only typed text layers enter Fabric. Never deserialize arbitrary Fabric JSON or URLs.
export function CreativeEditor({
  businessId,
  design,
  onChange,
  readOnly = false,
  previewOnly = false,
  chatControls = false,
  afterArtwork,
  controlsFooter,
  onExportReady,
}: {
  businessId: string;
  design: Design;
  onChange: (design: Design) => void;
  readOnly?: boolean;
  previewOnly?: boolean;
  chatControls?: boolean;
  afterArtwork?: ReactNode;
  controlsFooter?: ReactNode;
  onExportReady: (download: (() => void) | null) => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    element = useRef<HTMLCanvasElement>(null),
    canvas = useRef<Canvas | null>(null),
    current = useRef({ design, onChange, readOnly }),
    [selected, setSelected] = useState(design.layers[0]?.id ?? ""),
    [error, setError] = useState<unknown>(),
    [ready, setReady] = useState(false),
    [fontsLoading, setFontsLoading] = useState(false),
    [fontError, setFontError] = useState<unknown>(),
    [fontRetry, setFontRetry] = useState(0),
    [retry, setRetry] = useState(0);
  current.current = { design, onChange, readOnly };
  const exportRef = useRef(onExportReady);
  exportRef.current = onExportReady;
  useEffect(() => {
    let active = true,
      url: string | undefined;
    const controller = new AbortController();
    setError(undefined);
    setReady(false);
    exportRef.current(null);
    const c = new Canvas(element.current!, {
      width: design.width,
      height: design.height,
      selection: false,
      enableRetinaScaling: false,
      preserveObjectStacking: true,
    });
    canvas.current = c;
    c.upperCanvasEl.setAttribute("aria-hidden", "true");
    c.upperCanvasEl.tabIndex = -1;
    const fit = () => {
      if (!active || !host.current) return;
      const w = Math.min(host.current.clientWidth, design.width);
      c.setDimensions(
        { width: `${w}px`, height: `${(w * design.height) / design.width}px` },
        { cssOnly: true },
      );
      c.calcOffset();
    };
    const observer = new ResizeObserver(fit);
    observer.observe(host.current!);
    fit();
    const select = () => {
      const target = c.getActiveObject();
      if (target) setSelected((target as any).layerId);
    };
    c.on("selection:created", select);
    c.on("selection:updated", select);
    c.on("object:moving", ({ target }) => {
      const layer = current.current.design.layers.find(l => l.id === (target as any).layerId);
      const backing = c.getObjects().find(o => (o as any).backingId === layer?.id);
      if (backing && layer?.backing) backing.set({left:target.left-layer.backing.padding,top:target.top-layer.backing.padding});
    });
    c.on("object:modified", ({ target }) => {
      if (!target || current.current.readOnly) return;
      const d = current.current.design,
        id = (target as any).layerId;
      current.current.onChange({
        ...d,
        layers: d.layers.map((l) =>
          l.id === id
            ? {
                ...l,
                x: Math.max(
                  l.backing?.padding ?? 0,
                  Math.min(d.width - l.width - (l.backing?.padding ?? 0), Math.round(target.left)),
                ),
                y: Math.max(l.backing?.padding ?? 0, Math.min(d.height - target.height - (l.backing?.padding ?? 0), Math.round(target.top))),
              }
            : l,
        ),
      });
    });
    (async () => {
      try {
        const blob = await loadPrivateImage(`/api/v1/businesses/${businessId}/creative-media/${design.background_media_id}`,controller.signal);
        if (!active) return;
        url = URL.createObjectURL(blob);
        const image = await FabricImage.fromURL(url, {
          signal: controller.signal,
        });
        if (!active) {
          image.dispose();
          return;
        }
        image.set({ originX: "left", originY: "top", left: 0, top: 0 });
        c.backgroundImage = image;
        c.requestRenderAll();
        setReady(true);
      } catch (e) {
        if (active) setError(e);
      }
    })();
    return () => {
      active = false;
      controller.abort();
      observer.disconnect();
      exportRef.current(null);
      canvas.current = null;
      void c.dispose();
      if (url) URL.revokeObjectURL(url);
    };
  }, [
    businessId,
    design.background_media_id,
    design.width,
    design.height,
    retry,
  ]);
  useEffect(() => {
    const c = canvas.current;
    if (!c || !ready || !c.backgroundImage) return;
    let active = true;
    exportRef.current(null);
    setFontsLoading(true);
    setFontError(undefined);
    void loadDesignFonts(design.layers).then(() => {
      if (!active) return;
      const activeId = (c.getActiveObject() as any)?.layerId;
      c.discardActiveObject();
      for (const o of [...c.getObjects()]) { c.remove(o); o.dispose(); }
      for (const l of design.layers) {
        const interaction = {
          originX: "left" as const, originY: "top" as const,
          left:l.x, top:l.y, hasControls:false, lockScalingX:true, lockScalingY:true,
          lockRotation:true, strokeWidth:0, padding:4, borderColor:"#6a5cff", borderDashArray:[6,4],
          selectable:!readOnly,evented:!readOnly,lockMovementX:readOnly,lockMovementY:readOnly,
        };
        const text = l.curvature
          ? new FabricImage(paintCurvedText(document.createElement('canvas'),l),interaction)
          : new Textbox(l.text,{...interaction,editable:false,width:l.width,fontSize:l.fontSize,
              fontWeight:l.fontWeight??400,splitByGrapheme:!l.backing,fontFamily:l.fontFamily,
              fill:l.fill,textAlign:l.align});
        (text as any).layerId=l.id;
        c.add(text);
        if (l.text.trim() && l.backing) {
          const b = l.backing;
          const backing = new Rect({ originX:'left', originY:'top', left:l.x-b.padding, top:l.y-b.padding, width:l.width+2*b.padding, height:text.height+2*b.padding, fill:b.fill, opacity:b.opacity, strokeWidth:0, selectable:false, evented:false });
          (backing as any).backingId = l.id;
          c.add(backing);
        }
        c.bringObjectToFront(text);
        text.setCoords();
      }
      const selectedId = chatControls ? (design.layers.find(l=>l.id===selected)??design.layers[0])?.id : activeId;
      const selection = c.getObjects().find(o=>(o as any).layerId===selectedId);
      if (selection && !readOnly) c.setActiveObject(selection);
      c.requestRenderAll();
      // Export only the exact measured design, never a stale or fallback-font frame.
      c.renderAll();
      setFontsLoading(false);
      exportRef.current(() => {
        if (!active || current.current.design !== design) return;
        const link = document.createElement("a");
        link.download = "desvio-creative.png";
        link.href = c.toDataURL({format:"png",multiplier:1,enableRetinaScaling:false});
        link.click();
      });
    }).catch(error => {
      if (!active) return;
      setFontsLoading(false);
      setFontError(error);
      exportRef.current(null);
    });
    return () => { active = false; exportRef.current(null); };
  }, [design, readOnly, retry, ready, fontRetry]);
  const layer =
    design.layers.find((l) => l.id === selected) ?? design.layers[0];
  useEffect(()=>{
    if(!chatControls||!ready||fontsLoading)return;
    const c=canvas.current,object=c?.getObjects().find(o=>(o as any).layerId===layer?.id);
    if(!c)return;
    if(object&&!readOnly)c.setActiveObject(object);else c.discardActiveObject();
    c.requestRenderAll();
  },[chatControls,ready,fontsLoading,layer?.id,readOnly]);
  function update(values: Partial<Design["layers"][number]>) {
    if (!layer) return;
    onChange({
      ...design,
      layers: design.layers.map((l) =>
        l.id === layer.id ? (() => {
          const next = { ...l, ...values };
          if (next.backing) next.backing = { ...next.backing, padding: Math.max(0, Math.min(next.backing.padding, next.x, next.y, design.width-next.x-next.width)) };
          return next;
        })() : l,
      ),
    });
  }
  const number = (
    label: string,
    value: number,
    min: number,
    max: number,
    change: (n: number) => void,
  ) => (
    <Field label={label}>
      {(id) => (
        <input
          id={id}
          type="number"
          min={min}
          max={max}
          step={label === "Backing opacity" ? "0.05" : "1"}
          value={value}
          onChange={(e) => {
            if (e.target.value !== "") {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) change(Math.max(min, Math.min(max, n)));
            }
          }}
        />
      )}
    </Field>
  );
  return (
    <div className="creative-editor" style={chatControls?{'--artwork-ratio':design.width/design.height} as CSSProperties:undefined}>
      <section className="creative-artboard" aria-label="Creative preview">
        <div
          ref={host}
          className="creative-surface"
          aria-busy={(!ready && !error) || fontsLoading}
        >
          <canvas
            ref={element}
            aria-label={readOnly ? "Saved creative preview" : "Visual preview. Use the text layer fields to edit with a keyboard."}
          />
        </div>
        {!ready && !error && <p role="status">Loading your private image…</p>}
        {ready && fontsLoading && <p role="status">Loading your design fonts…</p>}
        {fontError instanceof Error && fontError.message==='EXPORT_TEXT_OVERFLOW'
          ? <p className="notice error" role="alert">This text is too tall for the image. Shorten it, reduce the font size, or use fewer lines.</p>
          : <Notice error={fontError} />}
        {!!fontError && !(fontError instanceof Error && fontError.message==='EXPORT_TEXT_OVERFLOW') && <button type="button" onClick={() => setFontRetry(n => n + 1)}>Retry fonts</button>}
        <Notice error={error} />
        {!!error && (
          <button onClick={() => setRetry((n) => n + 1)}>Reload image</button>
        )}
        <p className="hint">
          {design.width} × {design.height} ·{" "}
          {readOnly
            ? "Saved version"
            : "Drag text to position it, or use the fields below."}
        </p>
      </section>
      {afterArtwork}
      {!previewOnly && chatControls && <ChatLayerControls design={design} layer={layer} readOnly={readOnly} update={update} change={onChange} footer={controlsFooter} select={id=>{setSelected(id);const c=canvas.current,o=c?.getObjects().find(o=>(o as any).layerId===id);if(c&&o){c.setActiveObject(o);c.requestRenderAll();}}}/>}
      {!previewOnly && !chatControls && <fieldset className="creative-layer-controls" disabled={readOnly}>
        <legend>Text layers</legend><div className="creative-text-actions"><button type="button" disabled={!design.layers.some(l=>l.text.trim())} onClick={()=>onChange(readableDesign(design))}>Improve text contrast</button><button type="button" disabled={!design.layers.length} onClick={()=>onChange({...design,layers:[]})}>Remove all image text</button></div><p className="hint">Use a short headline or leave the image clean. Save your changes to update the post.</p>
        <Field label="Selected layer">
          {(id) => (
            <select
              id={id}
              value={layer?.id ?? ""}
              onChange={(e) => {
                setSelected(e.target.value);
                const c = canvas.current,
                  o = c
                    ?.getObjects()
                    .find((o) => (o as any).layerId === e.target.value);
                if (c && o) {
                  c.setActiveObject(o);
                  c.requestRenderAll();
                }
              }}
            >
              {design.layers.map((l, i) => (
                <option key={l.id} value={l.id}>
                  {i + 1}. {l.id}
                </option>
              ))}
            </select>
          )}
        </Field>
        {layer && (
          <>
            <Field label="Layer text">
              {(id) => (
                <textarea
                  id={id}
                  maxLength={1000}
                  value={layer.text}
                  onChange={(e) => update({ text: e.target.value })}
                />
              )}
            </Field>
            <TextCurveControls layer={layer} update={update}/>
            <div className="creative-fields">
              <Field label="Font">
                {(id) => (
                  <select
                    id={id}
                    value={layer.fontFamily}
                    onChange={(e) =>
                      update({ fontFamily: e.target.value as Design["layers"][number]["fontFamily"], fontWeight: designFontWeights(e.target.value).includes(layer.fontWeight ?? 400) ? layer.fontWeight ?? 400 : 400 })
                    }
                  >
                    {DESIGN_FONT_FAMILIES.map((f) => (
                      <option key={f}>{f}</option>
                    ))}
                  </select>
                )}
              </Field>
              {number("Font size", layer.fontSize, 8, 200, (n) =>
                update({ fontSize: n }),
              )}
              <Field label="Text weight">{id => <select id={id} value={layer.fontWeight ?? 400} onChange={e=>update({fontWeight:Number(e.target.value) as FontWeight})}>{designFontWeights(layer.fontFamily).map(weight=><option key={weight} value={weight}>{({100:"Thin",200:"Extra light",300:"Light",400:"Regular",500:"Medium",600:"Semibold",700:"Bold",800:"Extra bold",900:"Black"})[weight]}</option>)}</select>}</Field>
              <Field label="Contrast backing">{id => <input id={id} type="checkbox" checked={!!layer.backing} onChange={e=>update({backing:e.target.checked?{fill:'#111111',opacity:0.88,padding:Math.min(16,layer.x,layer.y,design.width-layer.x-layer.width)}:undefined})}/>}</Field>
              {layer.backing && <>
                <Field label="Backing color">{id => <input id={id} type="color" value={layer.backing!.fill} onChange={e=>update({backing:{...layer.backing!,fill:e.target.value}})}/>}</Field>
                {number("Backing opacity", layer.backing.opacity, 0, 1, n=>update({backing:{...layer.backing!,opacity:n}}))}
                {number("Backing padding", layer.backing.padding, 0, Math.min(48,layer.x,layer.y,design.width-layer.x-layer.width), n=>update({backing:{...layer.backing!,padding:n}}))}
              </>}
              <Field label="Text color">
                {(id) => (
                  <input
                    id={id}
                    type="color"
                    value={layer.fill}
                    onChange={(e) => update({ fill: e.target.value })}
                  />
                )}
              </Field>
              <Field label="Alignment">
                {(id) => (
                  <select
                    id={id}
                    value={layer.align}
                    onChange={(e) => update({ align: e.target.value as any })}
                  >
                    {["left", "center", "right"].map((f) => (
                      <option key={f}>{f}</option>
                    ))}
                  </select>
                )}
              </Field>
              {number(
                "Left position",
                layer.x,
                0,
                design.width - layer.width,
                (n) => update({ x: n }),
              )}
              {number("Top position", layer.y, 0, design.height - 1, (n) =>
                update({ y: n }),
              )}
              {number(
                "Text width",
                layer.width,
                10,
                design.width - layer.x,
                (n) => update({ width: n }),
              )}
            </div>
            <button
              type="button"
              onClick={() =>
                onChange({
                  ...design,
                  layers: design.layers.filter((l) => l.id !== layer.id),
                })
              }
            >
              Remove text layer
            </button>
          </>
        )}
        <button
          type="button"
          disabled={design.layers.length >= 10}
          onClick={() => {
            const id = "text-" + crypto.randomUUID().slice(0, 8);
            onChange({
              ...design,
              layers: [
                ...design.layers,
                {
                  id,
                  type: "text",
                  text: "Your text",
                  x: Math.round(design.width * 0.07),
                  y: Math.round(design.height * 0.4),
                  width: Math.round(design.width * 0.86),
                  fontSize: 40,
                  fontFamily: layer?.fontFamily ?? "DM Sans",
                  fontWeight: layer?.fontWeight ?? 400,
                  fill: "#201e1d",
                  align: "left",
                },
              ],
            });
            setSelected(id);
          }}
        >
          Add text layer
        </button>
      </fieldset>}
    </div>
  );
}
