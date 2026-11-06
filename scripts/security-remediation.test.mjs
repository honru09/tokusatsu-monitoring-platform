import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { resolveDatabaseUrl } = require("./restore-seeds.cjs");

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("restore-seeds requires a private DATABASE_URL", () => {
  assert.throws(() => resolveDatabaseUrl({}), /DATABASE_URL is required/);
  assert.throws(
    () =>
      resolveDatabaseUrl({
        DATABASE_URL:
          "postgresql://tokusatsu:change-me-in-production@127.0.0.1:55432/tokusatsu",
      }),
    /published placeholder/,
  );
  assert.equal(
    resolveDatabaseUrl({ DATABASE_URL: " postgresql://db.internal/app " }),
    "postgresql://db.internal/app",
  );
});

test("deploy scripts no longer embed the published database password", () => {
  const restore = read("./restore-seeds.cjs");
  const healer = read("./setup-spot-auto-healer.sh");
  const deploy = read("../deploy/gcp-auto-migrate.sh");
  assert.doesNotMatch(restore, /postgresql:\/\/tokusatsu:/);
  assert.doesNotMatch(healer, /change-me-in-production/);
  assert.doesNotMatch(deploy, /POSTGRES_PASSWORD=change-me-in-production/);
  assert.doesNotMatch(
    deploy,
    /postgresql:\/\/tokusatsu:change-me-in-production/,
  );
  assert.match(deploy, /POSTGRES_PASSWORD:\?/);
  assert.match(healer, /\. \.\/\.env/);
});

test("default compose keeps Redis open only as the compatible path and strips worker-only secrets", () => {
  const compose = read("../infrastructure/docker-compose.yml");
  assert.doesNotMatch(compose, /requirepass/);
  assert.match(compose, /127\.0\.0\.1:6379:6379/);
  for (const secret of [
    "AUTH_SECRET",
    "VAPID_PRIVATE_KEY",
    "XIANYU_SESSION_TOKEN",
    "RESALE_PUBLISHER_TOKEN",
    "RESALE_MARKET_SEARCH_TOKEN",
    "POSTGRES_PASSWORD",
    "CLOUDFLARE_TUNNEL_SECRET",
  ]) {
    assert.match(compose, new RegExp(`${secret}: ""`));
  }
  assert.doesNotMatch(read("../package.json"), /docker-compose\.security\.yml/);
});

test("Redis authentication and network segmentation stay opt-in", () => {
  const overlay = read("../infrastructure/docker-compose.security.yml");
  assert.match(overlay, /Opt-in/);
  assert.match(overlay, /requirepass/);
  assert.match(overlay, /REDIS_PASSWORD:\?/);
  assert.match(overlay, /internal: true/);
  assert.match(overlay, /!override/);
  assert.doesNotMatch(overlay, /read_only:/);
  assert.doesNotMatch(overlay, /cap_drop:/);
  assert.doesNotMatch(read("../deploy/gcp-auto-migrate.sh"), /docker-compose\.security\.yml/);
  assert.ok(root.endsWith("/"));
});
