import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

describe("dashboard session boot contracts", () => {
  it("guards the boot with a generation counter so a late response cannot apply a stale account", () => {
    expect(source).toMatch(/const sessionBootRef = useRef\(0\);/);
    expect(source).toMatch(
      /const boot = \+\+sessionBootRef\.current;[\s\S]*?const isCurrent = \(\) => boot === sessionBootRef\.current;/,
    );
    // Both awaits are followed by a currency check before state is set.
    expect(source).toMatch(
      /auth\/me[\s\S]*?if \(!isCurrent\(\)\) return;[\s\S]*?meResponse\.status === 401/,
    );
    expect(source).toMatch(
      /collaboration\/accounts[\s\S]*?if \(!isCurrent\(\)\) return;/,
    );
    expect(source).toMatch(
      /finally \{[\s\S]*?if \(isCurrent\(\)\) setManagerAccountsLoading\(false\);/,
    );
  });

  it("invalidates an in-flight boot on logout", () => {
    expect(source).toMatch(
      /function logout\(\) \{[\s\S]*?sessionBootRef\.current \+= 1;[\s\S]*?setActiveManagerId\(""\)/,
    );
  });

  it("revalidates the session when the page is restored from the back/forward cache", () => {
    expect(source).toContain('addEventListener("pageshow", onPageShow)');
    expect(source).toMatch(/if \(event\.persisted\) void loadSession\(\);/);
  });

  it("drops back to the login gate when the presence poll meets a 401", () => {
    expect(source).toMatch(
      /collaboration\/presence[\s\S]*?response\.status === 401[\s\S]*?clearSessionToken\(\);[\s\S]*?setActiveManagerId\(""\)/,
    );
  });
});
