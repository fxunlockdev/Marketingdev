import { CreativeError, type CreativeBrief } from "./creative-contracts.js";
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
    fontFamily: "Arial" | "Georgia" | "Verdana" | "DM Sans" | "DM Serif Display";
    fill: string;
    fontWeight?: 400 | 700;
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
  font?: "modern" | "classic" | "contrast",
): Design {
  return {
    schema_version: 1,
    width,
    height,
    background_media_id: mediaId,
    layers: [
      {
        id: "headline",
        type: "text",
        text: brief.headline,
        x: width * 0.07,
        y: height * 0.07,
        width: width * 0.86,
        fontSize: 56,
        fontFamily: font === "classic" ? "DM Serif Display" : font ? "DM Sans" : "Arial",
        fill: "#ffffff",
        fontWeight: 700,
        backing: { fill: "#111111", opacity: 0.88, padding: 16 },
        align: "left",
      },
      {
        id: "body",
        type: "text",
        text: visualBody(brief.body),
        x: width * 0.07,
        y: height * 0.68,
        width: width * 0.86,
        fontSize: 28,
        fontFamily: font ? "DM Sans" : "Arial",
        fill: "#ffffff",
        fontWeight: 700,
        backing: { fill: "#111111", opacity: 0.88, padding: 16 },
        align: "left",
      },
      {
        id: "cta",
        type: "text",
        text: visualCta(brief.cta),
        x: width * 0.07,
        y: height * 0.82,
        width: width * 0.86,
        fontSize: 32,
        fontFamily: font ? "DM Sans" : "Arial",
        fill: "#ffffff",
        fontWeight: 700,
        backing: { fill: "#111111", opacity: 0.88, padding: 16 },
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
      (l.fontWeight !== undefined && ![400, 700].includes(l.fontWeight)) ||
      (l.backing !== undefined && (!l.backing || Object.keys(l.backing).sort().join(",") !== "fill,opacity,padding" || !/^#[a-f0-9]{6}$/i.test(l.backing.fill) || !Number.isFinite(l.backing.opacity) || l.backing.opacity < 0 || l.backing.opacity > 1 || !Number.isFinite(l.backing.padding) || l.backing.padding < 0 || l.backing.padding > 48 || l.x < l.backing.padding || l.y < l.backing.padding || l.x + l.width + l.backing.padding > width)) ||
      l.type !== "text" ||
      typeof l.text !== "string" ||
      l.text.length > 1000 ||
      !["Arial", "Georgia", "Verdana", "DM Sans", "DM Serif Display"].includes(l.fontFamily) ||
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
      text: copy[layer.id] ?? layer.text,
    })),
  };
}
