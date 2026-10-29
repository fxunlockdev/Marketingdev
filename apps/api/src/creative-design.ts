import type {PostArtwork} from './post-artwork.js';
import { CreativeError, type CreativeBrief } from "./creative-contracts.js";
import {DESIGN_FONT_FAMILIES,designFontWeights,resolveBrandTypography,type BrandFontPreset,type BrandTypography,type DesignFontFamily,type FontWeight} from "./brand-typography.js";
export type Design = {
  schema_version: 1;
  width: number;
  height: number;
  background_media_id: string;
  layers: {
    id: string;
    type: "text";
    text: string;
    x: number;
    y: number;
    width: number;
    fontSize: number;
    fontFamily: DesignFontFamily;
    fill: string;
    fontWeight?: FontWeight;
    backing?: { fill: string; opacity: number; padding: number };
    align: "left" | "center" | "right";
  }[];
};
// Long explanations belong in the caption. The default layout has space for
// a short supporting line, not an article overlapping the CTA and photograph.
function visualBody(text: string): string { return text.trim().length <= 120 ? text.trim() : ""; }
function visualCta(text: string): string { return text.trim().length <= 80 ? text.trim() : ""; }
export function createDesign(
  mediaId: string,
  width: number,
  height: number,
  brief: CreativeBrief,
  font?: BrandFontPreset | BrandTypography,
  artwork?: PostArtwork,
): Design {
  const typography=resolveBrandTypography(artwork?.typography??font);
  if(font!==undefined&&!typography)throw new CreativeError("CREATIVE_DESIGN_INVALID");
  return {
    schema_version: 1,
    width,
    height,
    background_media_id: mediaId,
    layers: artwork?.text==='none'?[]:[
      {
        id: "headline",
        type: "text",
        text: brief.headline.trim().length<=90?brief.headline.trim():'',
        x: width * 0.07,
        y: height * 0.07,
        width: width * 0.86,
        fontSize: Math.round(Math.min(width,height)*0.055),
        fontFamily: typography?.headline.family??"DM Sans",
        fill: "#ffffff",
        fontWeight: typography?.headline.weight??700,
        backing: { fill: "#111111", opacity: 0.96, padding: 16 },
        align: "left",
      },
      {
        id: "body",
        type: "text",
        text: "",
        x: width * 0.07,
        y: height * 0.68,
        width: width * 0.86,
        fontSize: 28,
        fontFamily: typography?.body.family??"DM Sans",
        fill: "#ffffff",
        fontWeight: typography?.body.weight??700,
        backing: { fill: "#111111", opacity: 0.96, padding: 16 },
        align: "left",
      },
      {
        id: "cta",
        type: "text",
        text: "",
        x: width * 0.07,
        y: height * 0.82,
        width: width * 0.86,
        fontSize: 32,
        fontFamily: typography?.body.family??"DM Sans",
        fill: "#ffffff",
        fontWeight: typography?.body.weight??700,
        backing: { fill: "#111111", opacity: 0.96, padding: 16 },
        align: "left",
      },
    ],
  };
}
export function validateDesign(
  value: unknown,
  mediaId: string,
  width: number,
  height: number,
): Design {
  const v = value as any;
  if (
    !v ||
    Object.keys(v).sort().join(",") !==
      "background_media_id,height,layers,schema_version,width" ||
    v.schema_version !== 1 ||
    v.background_media_id !== mediaId ||
    v.width !== width ||
    v.height !== height ||
    !Array.isArray(v.layers) ||
    v.layers.length > 10
  )
    throw new CreativeError("CREATIVE_DESIGN_INVALID");
  const seen = new Set();
  for (const l of v.layers) {
    if (
      !l ||
      Object.keys(l).filter(k => !["fontWeight", "backing"].includes(k)).sort().join(",") !==
        "align,fill,fontFamily,fontSize,id,text,type,width,x,y" ||
      !/^[-a-z0-9]{1,40}$/.test(l.id) ||
      seen.has(l.id) ||
      (l.fontWeight !== undefined && !designFontWeights(l.fontFamily).includes(l.fontWeight)) ||
      (l.backing !== undefined && (!l.backing || Object.keys(l.backing).sort().join(",") !== "fill,opacity,padding" || !/^#[a-f0-9]{6}$/i.test(l.backing.fill) || !Number.isFinite(l.backing.opacity) || l.backing.opacity < 0 || l.backing.opacity > 1 || !Number.isFinite(l.backing.padding) || l.backing.padding < 0 || l.backing.padding > 48 || l.x < l.backing.padding || l.y < l.backing.padding || l.x + l.width + l.backing.padding > width)) ||
      l.type !== "text" ||
      typeof l.text !== "string" ||
      l.text.length > 1000 ||
      !(DESIGN_FONT_FAMILIES as readonly string[]).includes(l.fontFamily) ||
      !["left", "center", "right"].includes(l.align) ||
      !/^#[a-f0-9]{6}$/i.test(l.fill) ||
      ![l.x, l.y, l.width, l.fontSize].every(Number.isFinite) ||
      l.x < 0 ||
      l.x > width ||
      l.y < 0 ||
      l.y > height ||
      l.width < 10 ||
      l.width > width ||
      l.x + l.width > width + 1 ||
      l.fontSize < 8 ||
      l.fontSize > 200
    )
      throw new CreativeError("CREATIVE_DESIGN_INVALID");
    seen.add(l.id);
  }
  return v;
}

// An image revision must not reset the user's layout or remove custom text layers.
export function reviseDesign(
  parent: Design,
  mediaId: string,
  brief: CreativeBrief,
): Design {
  const copy: Record<string, string> = {
    headline: brief.headline,
    body: visualBody(brief.body),
    cta: visualCta(brief.cta),
  };
  return {
    ...parent,
    background_media_id: mediaId,
    layers: parent.layers.map((layer) => ({
      ...layer,
      text: layer.text.trim()?copy[layer.id] ?? layer.text:layer.text,
    })),
  };
}

/** Explicit editor action: readable contrast without changing the photo or font family. */
export function readableDesign(design:Design):Design{
 return {...design,layers:design.layers.map(layer=>({...layer,fill:'#ffffff',backing:{fill:'#111111',opacity:0.96,padding:Math.max(0,Math.min(16,layer.x,layer.y,design.width-layer.x-layer.width))}}))};
}
