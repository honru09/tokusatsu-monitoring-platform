// @vitest-environment node
import { readFile, stat } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const illustrationsDirectory = new URL(
  "../../public/illustrations/",
  import.meta.url,
);
const componentsDirectory = new URL("../components/", import.meta.url);

// Second-wave assets (batch 9): file name and the byte size installed
// on disk. The spots ship at 480x480; the two scenes were downscaled
// to display size (1280px / 960px wide) before install.
const WAVE_TWO_ASSETS = [
  ["header-todo.webp", 7_288],
  ["header-catalog.webp", 17_104],
  ["header-chat.webp", 6_300],
  ["header-dashboard.webp", 11_092],
  ["brand-home.webp", 25_774],
  ["detail-placeholder-wide.webp", 17_058],
  ["detail-empty-description.webp", 6_702],
  ["error-art.webp", 10_398],
] as const;

describe("second-wave illustration assets", () => {
  it.each(WAVE_TWO_ASSETS)("installs %s at its shipped size", async (name, bytes) => {
    const info = await stat(new URL(name, illustrationsDirectory));
    expect(info.size).toBe(bytes);
  });

  it("keeps the whole wave under 150 KB", async () => {
    let total = 0;
    for (const [name] of WAVE_TWO_ASSETS) {
      total += (await stat(new URL(name, illustrationsDirectory))).size;
    }
    expect(total).toBeLessThan(150_000);
  });

  it("references every wired asset from its surface", async () => {
    const [headerArt, todoHome, itemImage, detailDisclosure] =
      await Promise.all([
        readFile(new URL("workspace-header-art.tsx", componentsDirectory), "utf8"),
        readFile(new URL("todo-home.tsx", componentsDirectory), "utf8"),
        readFile(new URL("item-image.tsx", componentsDirectory), "utf8"),
        readFile(new URL("detail-disclosure.tsx", componentsDirectory), "utf8"),
      ]);
    for (const name of [
      "header-todo.webp",
      "header-catalog.webp",
      "header-chat.webp",
      "header-dashboard.webp",
    ]) {
      expect(headerArt).toContain(`/illustrations/${name}`);
    }
    expect(todoHome).toContain("/illustrations/brand-home.webp");
    expect(itemImage).toContain("/illustrations/detail-placeholder-wide.webp");
    expect(detailDisclosure).toContain(
      "/illustrations/detail-empty-description.webp",
    );
    // error-art.webp is installed but deliberately unwired: the only
    // shared error surface is the compact inline LoadError strip,
    // which has no room for an illustration slot.
  });
});
