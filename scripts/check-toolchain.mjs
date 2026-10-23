import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  readFileSync(resolve(projectRoot, "package.json"), "utf8"),
);
const expectedNode = manifest.devEngines?.runtime?.version;
const expectedPnpm = manifest.packageManager?.match(/^pnpm@(.+)$/)?.[1];
const actualPnpm = (process.env.npm_config_user_agent ?? "").match(
  /^pnpm\/([^\s]+)/,
)?.[1];

if (process.versions.node !== expectedNode || actualPnpm !== expectedPnpm) {
  console.error(
    `Toolchain mismatch: expected Node.js ${expectedNode} with pnpm ${expectedPnpm}; received Node.js ${process.versions.node} with pnpm ${actualPnpm ?? "unknown"}.`,
  );
  console.error(
    "Activate the repository .node-version or .nvmrc with your version manager, run corepack enable, then retry pnpm install.",
  );
  process.exit(1);
}

const pnpmEntry = process.env.npm_execpath;
if (!pnpmEntry) {
  console.error("Toolchain mismatch: npm_execpath is unset.");
  process.exit(1);
}

const nested = spawnSync(
  process.execPath,
  [pnpmEntry, "exec", "node", "-p", "process.versions.node"],
  {
    cwd: projectRoot,
    env: {
      ...process.env,
      npm_node_execpath: process.execPath,
    },
    encoding: "utf8",
  },
);
const nestedNode = nested.stdout?.trim();

if (nested.status !== 0 || nestedNode !== expectedNode) {
  if (nested.stderr) process.stderr.write(nested.stderr);
  console.error(
    `Nested pnpm runtime mismatch: expected Node.js ${expectedNode}, received ${nestedNode || "unknown"}.`,
  );
  process.exit(1);
}

console.log(`Toolchain OK: Node.js ${expectedNode}, pnpm ${expectedPnpm}.`);
