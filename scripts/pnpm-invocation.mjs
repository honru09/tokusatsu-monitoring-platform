import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Return a Node-runnable pnpm command.
 *
 * On Windows, spawning the `pnpm.cmd` shim directly can raise EINVAL when the
 * caller uses child_process.execFile (notably from a detached watchdog). The
 * shim itself only forwards to Corepack's JavaScript entry, so invoke that
 * entry with the current Node binary instead. Keeping this in one small
 * helper also makes scheduled jobs work when npm_execpath is not inherited.
 */
export function pnpmInvocation(args = [], environment = process.env) {
  const inherited = environment.npm_execpath?.trim();
  if (inherited && /\.(?:c?m?js)$/iu.test(inherited) && existsSync(inherited)) {
    return { command: process.execPath, args: [inherited, ...args] };
  }

  const corepackEntry = join(
    dirname(process.execPath),
    "node_modules",
    "corepack",
    "dist",
    "pnpm.js",
  );
  if (existsSync(corepackEntry)) {
    return { command: process.execPath, args: [corepackEntry, ...args] };
  }

  // Unix installations commonly expose a real pnpm executable. On Windows we
  // deliberately fail with a clear error instead of returning pnpm.cmd, whose
  // direct execFile path is the source of the EINVAL failure this guards.
  if (process.platform === "win32") {
    throw new Error("找不到可由 Node 启动的 pnpm Corepack 入口");
  }
  return { command: "pnpm", args };
}
