import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
// Explicitly stage an allowlisted context. Legacy Docker builders ignore
// Dockerfile-specific ignore files; never send the checkout, credentials or node_modules.
export function prepareRenderImage() {
  const context = mkdtempSync(join(tmpdir(), "desvio-render-build-"));
  try {
    for (const relative of [
      "apps/media/Dockerfile",
      "apps/media/package.json",
      "apps/media/package-lock.json",
      "apps/media/runtime.mjs",
    ]) {
      const target = join(context, relative);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(join(root, relative), target);
    }
    execFileSync(
      "docker",
      [
        "build",
        "-q",
        "-t",
        "desvio-render:local",
        "-f",
        join(context, "apps/media/Dockerfile"),
        context,
      ],
      { stdio: ["ignore", "pipe", "pipe"], timeout: 300000 },
    );
    const image = execFileSync(
      "docker",
      ["image", "inspect", "desvio-render:local", "--format", "{{.Id}}"],
      { encoding: "utf8", timeout: 10000 },
    ).trim();
    if (!/^sha256:[a-f0-9]{64}$/.test(image))
      throw new Error("Renderer image digest missing");
    console.log(
      `Actual isolated Fabric renderer ${image}; no network or credentials`,
    );
    return image;
  } finally {
    rmSync(context, { recursive: true, force: true });
  }
}
