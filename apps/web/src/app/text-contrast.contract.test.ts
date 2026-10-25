import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const srcRoot = new URL(".", import.meta.url).pathname;
const globals = readFileSync(new URL("./globals.css", import.meta.url), "utf8");

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(path);
    return entry.name.endsWith(".tsx") ? [path] : [];
  });
}

const smallSize = /text-\[1[01](?:\.5)?px\]/;
const lowInk = /text-ink\/(?:30|35|40|45|50|55)\b/;

describe("small text contrast floor", () => {
  it("defines the text-meta semantic class at the ink/60 floor", () => {
    const body = globals.match(/\.text-meta\s*\{([^}]*)\}/)?.[1];
    expect(body).toBeTruthy();
    expect(body).toMatch(/color:\s*rgb\(29 29 31 \/ 0\.6\)/);
  });

  it("never pairs caption-size text with sub-floor ink opacity", () => {
    const offenders: string[] = [];
    for (const file of tsxFiles(srcRoot)) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, index) => {
        if (smallSize.test(line) && lowInk.test(line)) {
          offenders.push(`${file}:${index + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
