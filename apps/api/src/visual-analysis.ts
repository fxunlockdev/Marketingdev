import sharp from "sharp";
import { ObjectStore, digest } from "./object-store.js";
import { IntakeError } from "./safe-web.js";

export type VisualInput = {
  id: string;
  visual_id: string;
  source_id: string;
  website_url: string;
  viewport: string;
  view: "overview" | "hero" | "detail";
  source_sha256: string;
  sha256: string;
  crop: { x: number; y: number; width: number; height: number };
  width: number;
  height: number;
  image: string;
};
export const visualManifest = (images: VisualInput[]) =>
  images.map(({ image, ...reference }) => reference);

// Only screenshots read through the scoped worker query enter here. No URLs are
// fetched, no remote image is followed, and no private storage URL reaches OpenAI.
export async function prepareVisuals(
  store: ObjectStore,
  rows: any[],
): Promise<VisualInput[]> {
  if (rows.length > 10) throw new IntakeError("AI_VISUAL_INPUT_LIMIT");
  const images: VisualInput[] = [];
  let total = 0;
  for (const row of rows) {
    const bytes = await store.read(row.object_key, 6 * 1024 * 1024);
    if (bytes.length !== row.bytes || digest(bytes) !== row.sha256)
      throw new IntakeError("AI_VISUAL_INTEGRITY_FAILED");
    const metadata = await sharp(bytes, {
      limitInputPixels: 25_000_000,
    }).metadata();
    if (
      metadata.format !== "jpeg" ||
      metadata.width !== row.width ||
      metadata.height !== row.height
    )
      throw new IntakeError("AI_VISUAL_INTEGRITY_FAILED");
    const height = Math.min(row.height, 1200);
    const regions: { view: VisualInput["view"]; y: number; height: number }[] =
      [{ view: "overview", y: 0, height: row.height }];
    if (row.height > 1600) {
      regions.push({ view: "hero", y: 0, height });
      const candidate = (row.observations.images ?? [])
        .filter(
          (i: any) =>
            i.loaded &&
            i.box?.y >= height &&
            i.box?.y < row.height &&
            i.box?.width > 100 &&
            i.box?.height > 100,
        )
        .sort(
          (a: any, b: any) =>
            b.box.width * b.box.height - a.box.width * a.box.height,
        )[0];
      const top = Math.round(candidate?.box?.y ?? (row.height - height) / 2);
      regions.push({
        view: "detail",
        y: Math.max(0, Math.min(top, row.height - height)),
        height,
      });
    }
    for (const region of regions) {
      const crop = {
        x: 0,
        y: region.y,
        width: row.width,
        height: region.height,
      };
      const encoded = await sharp(bytes, { limitInputPixels: 25_000_000 })
        .extract({
          left: crop.x,
          top: crop.y,
          width: crop.width,
          height: crop.height,
        })
        .resize({
          width: 1440,
          height: 2048,
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality: 85 })
        .toBuffer({ resolveWithObject: true });
      total += encoded.data.length;
      if (total > 12 * 1024 * 1024)
        throw new IntakeError("AI_VISUAL_INPUT_LIMIT");
      images.push({
        id: `${row.id}:${region.view}`,
        visual_id: row.id,
        source_id: row.source_id,
        website_url: row.website_url,
        viewport: row.viewport,
        view: region.view,
        source_sha256: row.sha256,
        sha256: digest(encoded.data),
        crop,
        width: encoded.info.width,
        height: encoded.info.height,
        image: encoded.data.toString("base64"),
      });
    }
  }
  return images;
}
