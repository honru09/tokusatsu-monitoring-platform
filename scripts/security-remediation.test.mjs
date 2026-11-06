import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { resolveDatabaseUrl } = require("./restore-seeds.cjs");
const {
  databaseUrlForHostPort,
  redactSecrets,
} = require("./database-url.cjs");
const { restoreOnHost } = require("./restore-on-host.cjs");

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

test("published manager migrations keep their Prisma checksums", () => {
  const files = {
    "../packages/db/prisma/migrations/20261025170000_manager_login_credentials/migration.sql":
      "41b2ed6267683b959ca5afa3ca5746200f964e436bc404be2c06e550a71bd5b6",
    "../packages/db/prisma/migrations/20261025200000_swap_manager_login_codes/migration.sql":
      "1ef742757cc0b2a3a08ff0801ee474653eea63fece25080edc7f1e65a49947a2",
  };
  for (const [path, checksum] of Object.entries(files)) {
    const bytes = readFileSync(new URL(path, import.meta.url));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), checksum);
  }
  const diff = spawnSync(
    "git",
    [
      "diff",
      "--exit-code",
      "959982a3f550aa658a87ce33179bbc59827e66e9",
      "--",
      "packages/db/prisma/migrations/20261025170000_manager_login_credentials/migration.sql",
      "packages/db/prisma/migrations/20261025200000_swap_manager_login_codes/migration.sql",
    ],
    { cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8" },
  );
  assert.equal(diff.status, 0);
  assert.equal(diff.stdout, "");
});

test("host restore rewrites a synthetic URL and does not print its password", () => {
  const password = "synthetic-password";
  const original = `postgresql://tokusatsu:${password}@postgres:5432/tokusatsu?schema=public`;
  const hostUrl = new URL(databaseUrlForHostPort(original));
  assert.equal(hostUrl.hostname, "127.0.0.1");
  assert.equal(hostUrl.port, "55432");
  assert.equal(hostUrl.password, password);
  assert.equal(
    redactSecrets(`connect failed ${original}`).includes(password),
    false,
  );
  const result = restoreOnHost({
    ...process.env,
    DATABASE_URL: "postgresql://tokusatsu:synthetic-password@127.0.0.1:1/tokusatsu?schema=public",
  });
  const output = `${result.stdout}${result.stderr}`;
  assert.equal(output.includes("synthetic-password"), false);
  assert.equal(output.includes("change-me-in-production"), false);
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
  assert.match(deploy, /restore-on-host\.cjs/);
  assert.match(healer, /\. \.\/\.env/);
  assert.match(healer, /restore-on-host\.cjs/);
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
