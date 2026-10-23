import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const webDirectory = new URL("../apps/web/", import.meta.url);
const publicDirectory = new URL("public/", webDirectory);
const webRequire = createRequire(new URL("package.json", webDirectory));
const sharp = createRequire(webRequire.resolve("next/package.json"))("sharp");
const source = await readFile(new URL("brand-icon.svg", publicDirectory));
const assets = [
  ["favicon-32x32.png", 32],
  ["apple-touch-icon.png", 180],
  ["icon-192.png", 192],
  ["icon-512.png", 512],
];

// Rasterize the complete vector separately for each target. Never crop or
// reuse a mutable Sharp pipeline that can inherit a previous target's size.
await Promise.all(
  assets.map(([name, size]) =>
    sharp(source, { density: 576 })
      .resize(size, size, { fit: "contain", background: "#ffffff" })
      .flatten({ background: "#ffffff" })
      .png()
      .toFile(fileURLToPath(new URL(name, publicDirectory))),
  ),
);

// Maskable icons get their own inset artwork; the standard app icon should
// not be expanded/cropped by Android's device-specific masks.
const maskableArtwork = await sharp(source, { density: 576 })
  .resize(432, 432, { fit: "contain", background: "#ffffff" })
  .flatten({ background: "#ffffff" })
  .png()
  .toBuffer();
await sharp({
  create: { width: 512, height: 512, channels: 3, background: "#ffffff" },
})
  .composite([{ input: maskableArtwork, left: 40, top: 40 }])
  .png()
  .toFile(fileURLToPath(new URL("icon-maskable-512.png", publicDirectory)));

await writeFile(new URL("src/app/icon.svg", webDirectory), source);
console.log("Generated 5 PNG icons and synced Next.js icon.svg from brand-icon.svg.");
