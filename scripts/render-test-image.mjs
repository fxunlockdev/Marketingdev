import {runtimeArchitecture,assertRuntimeArchitecture,renderRuntimeImage} from './runtime-architecture.mjs';
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
// Explicitly stage an allowlisted context. Legacy Docker builders ignore
// Dockerfile-specific ignore files; never send the checkout, credentials or node_modules.
export function prepareRenderImage() {
  const architecture=runtimeArchitecture(),tag=`desvio-render:${architecture}`;
  const context = mkdtempSync(join(tmpdir(), "desvio-render-build-"));
  try {
    for (const relative of [
      "apps/media/Dockerfile",
      "apps/media/package.json",
      "apps/media/package-lock.json",
      "apps/media/runtime.mjs",
      "apps/web/public/fonts/dm-sans.ttf",
      "apps/web/public/fonts/dm-serif-display.ttf",
      "apps/web/public/fonts/dmsans-OFL.txt",
      "apps/web/public/fonts/dmserifdisplay-OFL.txt",
      "apps/web/public/fonts/playfairdisplay.ttf",
      "apps/web/public/fonts/montserrat.ttf",
      "apps/web/public/fonts/lora.ttf",
      "apps/web/public/fonts/oswald.ttf",
      "apps/web/public/fonts/playfairdisplay-OFL.txt",
      "apps/web/public/fonts/montserrat-OFL.txt",
      "apps/web/public/fonts/lora-OFL.txt",
      "apps/web/public/fonts/oswald-OFL.txt",
      "apps/web/public/fonts/sources.json",
      ...Object.entries({'dm-sans':[100,200,300,400,500,600,700,800,900],playfairdisplay:[400,500,600,700,800,900],montserrat:[100,200,300,400,500,600,700,800,900],lora:[400,500,600,700],oswald:[200,300,400,500,600,700]}).flatMap(([name,weights])=>weights.map(weight=>`apps/media/fonts/${name}-${weight}.ttf`)),
    ]) {
      const target = join(context, relative);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(join(root, relative), target);
    }
    execFileSync(
      "docker",
      [
        "build", "--platform", `linux/${architecture}`, "--build-arg", `BASE_IMAGE=${renderRuntimeImage(architecture)}`,
        "-q",
        "-t",
        tag,
        "-f",
        join(context, "apps/media/Dockerfile"),
        context,
      ],
      { stdio: ["ignore", "pipe", "pipe"], timeout: 1800000 },
    );
    const image = execFileSync(
      "docker",
      ["image", "inspect", tag, "--format", "{{.Id}}"],
      { encoding: "utf8", timeout: 10000 },
    ).trim();
    if (!/^sha256:[a-f0-9]{64}$/.test(image))
      throw new Error("Renderer image digest missing");
    console.log(
      `Actual isolated Fabric renderer ${image}; no network or credentials`,
    );
    assertRuntimeArchitecture(image,architecture);
    return image;
  } finally {
    rmSync(context, { recursive: true, force: true });
  }
}
