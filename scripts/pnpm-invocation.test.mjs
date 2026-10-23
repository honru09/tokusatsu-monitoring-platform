import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { pnpmInvocation } from "./pnpm-invocation.mjs";

test("scheduled pnpm jobs use a Node-runnable Corepack entry on Windows", () => {
  const invocation = pnpmInvocation(["--version"], {});
  assert.equal(invocation.command, process.execPath);
  assert.match(invocation.args[0], /corepack[\\/]dist[\\/]pnpm\.js$/iu);
  assert.deepEqual(invocation.args.slice(1), ["--version"]);
});

test("an inherited JavaScript pnpm entry is preferred when available", () => {
  const inheritedEntry = join(
    dirname(process.execPath),
    "node_modules",
    "corepack",
    "dist",
    "pnpm.js",
  );
  const invocation = pnpmInvocation(["queue:maintain"], {
    npm_execpath: inheritedEntry,
  });
  assert.equal(invocation.command, process.execPath);
  assert.deepEqual(invocation.args, [inheritedEntry, "queue:maintain"]);
});
