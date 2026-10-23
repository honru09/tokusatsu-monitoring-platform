// @vitest-environment node
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import manifest from "./manifest";

const localRequire = createRequire(import.meta.url);
const sharp = createRequire(localRequire.resolve("next/package.json"))("sharp");
const publicDirectory = new URL("../../public/", import.meta.url);
const rasterIcons = [
  ["favicon-32x32.png", 32],
  ["apple-touch-icon.png", 180],
  ["icon-192.png", 192],
  ["icon-512.png", 512],
] as const;

async function pixels(name: string) {
  return sharp(fileURLToPath(new URL(name, publicDirectory)))
    .flatten({ background: "#fff" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
}

describe("app icon raster framing", () => {
  it.each(rasterIcons)("keeps the complete logo centered in %s", async (name, size) => {
    const { data, info } = await pixels(name);
    expect([info.width, info.height]).toEqual([size, size]);
    let minX: number = size;
    let minY: number = size;
    let maxX = -1;
    let maxY = -1;
    let inkPixels = 0;
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const index = (y * size + x) * info.channels;
        if (data[index] >= 128) continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        inkPixels += 1;
      }
    }

    // A correct PNG has the whole front-facing head, not a viewport clipped
    // from a larger raster (the previous 180/192 assets showed its top-left).
    expect(inkPixels).toBeGreaterThan(size * size * 0.055);
    expect(inkPixels).toBeLessThan(size * size * 0.24);
    expect(minX).toBeGreaterThanOrEqual(size * 0.1);
    expect(minY).toBeGreaterThanOrEqual(size * 0.1);
    expect(maxX).toBeLessThan(size * 0.9);
    expect(maxY).toBeLessThan(size * 0.9);
    expect(Math.abs((minX + maxX) / 2 - (size - 1) / 2)).toBeLessThan(size * 0.025);
    expect(Math.abs((minY + maxY) / 2 - (size - 1) / 2)).toBeLessThan(size * 0.025);
  });

  it("uses one canonical vector for the browser and app brand", async () => {
    const [brand, appIcon] = await Promise.all([
      readFile(new URL("brand-icon.svg", publicDirectory), "utf8"),
      readFile(new URL("icon.svg", import.meta.url), "utf8"),
    ]);
    expect(appIcon.trim()).toBe(brand.trim());
    expect(brand).toContain('width="64" height="64"');
    expect(brand).toContain('viewBox="0 0 64 64"');
    expect(brand).toContain('preserveAspectRatio="xMidYMid meet"');
  });

  it.each(rasterIcons)("renders the whole canonical artwork in %s", async (name) => {
    const source = await readFile(new URL("brand-icon.svg", publicDirectory));
    const reference = await sharp(source)
      .resize(32, 32)
      .flatten({ background: "#fff" })
      .greyscale()
      .raw()
      .toBuffer();
    const actual = await sharp(fileURLToPath(new URL(name, publicDirectory)))
      .resize(32, 32)
      .flatten({ background: "#fff" })
      .greyscale()
      .raw()
      .toBuffer();
    let error = 0;
    for (let index = 0; index < reference.length; index += 1) {
      error += Math.abs(reference[index] - actual[index]);
    }
    // Allow antialiasing differences at 32px, never a different crop.
    expect(error / reference.length).toBeLessThan(9);
  });

  it("keeps all maskable artwork inside the guaranteed safe circle", async () => {
    const { data, info } = await pixels("icon-maskable-512.png");
    expect([info.width, info.height]).toEqual([512, 512]);
    let inkPixels = 0;
    let maxInkRadius = 0;
    for (let y = 0; y < info.height; y += 1) {
      for (let x = 0; x < info.width; x += 1) {
        if (data[(y * info.width + x) * info.channels] >= 128) continue;
        inkPixels += 1;
        maxInkRadius = Math.max(maxInkRadius, Math.hypot(x - 255.5, y - 255.5));
      }
    }
    expect(inkPixels).toBeGreaterThan(512 * 512 * 0.035);
    expect(maxInkRadius).toBeLessThan(512 * 0.4);
  });

  it("publishes separate standard and maskable app icons", () => {
    expect(manifest().icons).toEqual([
      { src: "/icon-192.png?v=2", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png?v=2", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png?v=2", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ]);
  });
});
