import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  readFileSync(resolve(projectRoot, "package.json"), "utf8"),
);
const expectedNode = manifest.devEngines?.runtime?.version;
const expectedPackageManager = manifest.packageManager;

if (process.versions.node !== expectedNode) {
  console.error(
    `Expected Node.js ${expectedNode}, received ${process.versions.node}. Activate .node-version or .nvmrc, run corepack enable, then retry pnpm install.`,
  );
  process.exit(1);
}

const userAgent = process.env.npm_config_user_agent ?? "";
const actualPackageManager = userAgent.match(/^pnpm\/([^\s]+)/)?.[1];
const expectedPnpm = expectedPackageManager?.match(/^pnpm@(.+)$/)?.[1];

if (!expectedPnpm || actualPackageManager !== expectedPnpm) {
  console.error(
    `Expected pnpm ${expectedPnpm ?? "<invalid packageManager>"}, received ${actualPackageManager ?? "unknown"}.`,
  );
  process.exit(1);
}

const pnpmEntry = process.env.npm_execpath;
if (!pnpmEntry) {
  console.error(
    "Cannot locate the active pnpm entry point (npm_execpath is unset).",
  );
  process.exit(1);
}

const child = spawnSync(
  process.execPath,
  [pnpmEntry, ...process.argv.slice(2)],
  {
    cwd: projectRoot,
    env: {
      ...process.env,
      npm_node_execpath: process.execPath,
    },
    stdio: "inherit",
  },
);

if (child.error) {
  console.error(child.error.message);
  process.exit(1);
}

process.exit(child.status ?? 1);
