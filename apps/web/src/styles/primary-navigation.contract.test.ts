import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The bottom navigation's geometry has exactly one owner:
 * `.primary-navigation.ios-nav` in styles/mobile-chrome.css. Several
 * stylesheets used to define it at once (all !important), and on a real
 * iPhone the leftovers combined into a full-width bar shoved half off
 * screen. These tests keep a second definition from growing back.
 */
const stylesDir = new URL("./", import.meta.url);
const appDir = new URL("../app/", import.meta.url);
const componentsDir = new URL("../components/", import.meta.url);

const AUTHORITY = "mobile-chrome.css";

const GEOMETRY_PROPERTY =
  /^(position|inset(-[a-z]+)*|top|right|bottom|left|width|min-width|max-width|height|min-height|max-height|transform|translate|scale|rotate|margin(-[a-z]+)*|padding(-[a-z]+)*|border-radius|border-(top|bottom)-(left|right)-radius)$/;

// `.primary-navigation` itself or `.ios-nav`, but not `.primary-navigation-item`
// and friends, and not the CSS-module `.navigation` class.
const NAV_SELECTOR = /\.(primary-navigation|ios-nav)(?![\w-])/;

function readCss(url: URL): string {
  return readFileSync(url, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
}

function styleSheets(): { name: string; css: string }[] {
  const sheets = readdirSync(stylesDir)
    .filter((file) => file.endsWith(".css"))
    .map((file) => ({ name: `styles/${file}`, css: readCss(new URL(file, stylesDir)) }));
  sheets.push({ name: "app/globals.css", css: readCss(new URL("globals.css", appDir)) });
  for (const file of readdirSync(componentsDir)) {
    if (file.endsWith(".css") && !file.endsWith(".module.css")) {
      sheets.push({ name: `components/${file}`, css: readCss(new URL(file, componentsDir)) });
    }
  }
  return sheets;
}

/** Every innermost `selector { declarations }` block, media wrappers flattened. */
function rules(css: string): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (const match of css.matchAll(re)) {
    out.push({ selector: match[1].trim(), body: match[2] });
  }
  return out;
}

function geometryDeclarations(body: string): string[] {
  return body
    .split(";")
    .map((decl) => decl.split(":")[0]?.trim().toLowerCase() ?? "")
    .filter((prop) => GEOMETRY_PROPERTY.test(prop));
}

function navGeometryViolations(css: string): string[] {
  const found: string[] = [];
  for (const { selector, body } of rules(css)) {
    if (!selector.split(",").some((part) => NAV_SELECTOR.test(part))) continue;
    for (const prop of geometryDeclarations(body)) {
      found.push(`${selector.replace(/\s+/g, " ")} { ${prop} }`);
    }
  }
  return found;
}

describe("primary navigation geometry has a single owner", () => {
  it("finds the stylesheets it is supposed to police", () => {
    const names = styleSheets().map((sheet) => sheet.name);
    expect(names).toContain("app/globals.css");
    expect(names).toContain(`styles/${AUTHORITY}`);
    expect(names).toContain("styles/simple-apple.css");
    expect(names).toContain("styles/apple-polish.css");
  });

  it("declares no nav geometry outside mobile-chrome.css", () => {
    const violations = styleSheets()
      .filter((sheet) => sheet.name !== `styles/${AUTHORITY}`)
      .flatMap((sheet) =>
        navGeometryViolations(sheet.css).map((v) => `${sheet.name}: ${v}`),
      );
    expect(violations).toEqual([]);
  });

  it("keeps the authoritative rule on the final pill geometry", () => {
    const css = readCss(new URL(AUTHORITY, stylesDir));
    const base = rules(css).find(
      (rule) => rule.selector === ".primary-navigation.ios-nav" && /position:/.test(rule.body),
    );
    expect(base).toBeTruthy();
    const body = base!.body.replace(/\s+/g, " ");
    expect(body).toMatch(/position:\s*fixed/);
    expect(body).toMatch(/left:\s*50%/);
    expect(body).toMatch(/transform:\s*translateX\(-50%\)/);
    expect(body).toMatch(/bottom:\s*max\(12px,\s*env\(safe-area-inset-bottom\)\)/);
    expect(body).toMatch(/width:\s*min\(calc\(100% - 24px\),\s*400px\)/);
    expect(body).toMatch(/\sheight:\s*58px/);
    expect(body).toMatch(/min-height:\s*58px/);
    expect(body).toMatch(/border-radius:\s*9999px/);
    expect(body).toMatch(/background:\s*#fff(fff)?\b/);
    expect(body).toMatch(/z-index:\s*100/);
  });

  it("defines the authoritative rule once, outside any phone-only media query", () => {
    const css = readCss(new URL(AUTHORITY, stylesDir));
    const withPosition = rules(css).filter(
      (rule) =>
        rule.selector === ".primary-navigation.ios-nav" && /(^|[\s;])position:/.test(rule.body),
    );
    expect(withPosition).toHaveLength(1);
    // The rule sits at top level: nothing but whitespace/rules precede it at depth 0.
    const index = css.indexOf(".primary-navigation.ios-nav {");
    const before = css.slice(0, index);
    const opens = (before.match(/\{/g) ?? []).length;
    const closes = (before.match(/\}/g) ?? []).length;
    expect(opens).toBe(closes);
  });

  it("only lets the desktop override live in the same file, above 1024px", () => {
    const css = readCss(new URL(AUTHORITY, stylesDir));
    const overrides = [
      ...css.matchAll(/@media\s*([^{]+)\{\s*\.primary-navigation\.ios-nav\s*\{[^}]*\}\s*\}/g),
    ];
    expect(overrides).toHaveLength(1);
    expect(overrides[0][1]).toMatch(/min-width:\s*1024px/);
  });

  it("leaves page content clear of the nav pill on phones (360px)", () => {
    const css = readCss(new URL(AUTHORITY, stylesDir));
    const clearance = css.match(
      /\.procurement-content\s*\{[^}]*padding-bottom:\s*calc\((\d+)px \+ env\(safe-area-inset-bottom\)\)/,
    );
    expect(clearance).toBeTruthy();
    // Pill height 58 + bottom offset 12 (the offset grows with the safe
    // area, and so does the padding).
    expect(Number(clearance![1])).toBeGreaterThanOrEqual(58 + 12);
  });
});
