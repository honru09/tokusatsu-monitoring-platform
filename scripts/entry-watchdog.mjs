import { readFile, writeFile, rename, mkdir, appendFile, stat, statfs } from "node:fs/promises";
import { readFileSync, unlinkSync } from "node:fs";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { TunnelSupervisor, probeApplication, validTunnelUrl } from "./entry-watchdog-core.mjs";
import { sendEntryNotification } from "./notify-entry.mjs";
import { startRescueListener, getRescueTopic, notifyRescueTopic, executeSystemHygiene } from "./emergency-rescue.mjs";
import { pnpmInvocation } from "./pnpm-invocation.mjs";

const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const privateDir = join(root, ".private-entry");
await mkdir(privateDir, { recursive: true });

async function processInfo(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return null;
  const { stdout } = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `$p=Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}'; if($p){[pscustomobject]@{pid=$p.ProcessId;name=$p.Name;path=$p.ExecutablePath;command=$p.CommandLine;created=$p.CreationDate.ToUniversalTime().ToString('o')}|ConvertTo-Json -Compress}`], { windowsHide: true, timeout: 15_000 });
  return stdout.trim() ? JSON.parse(stdout) : null;
}

// 进程单例排他锁（Singleton PID Guard）
const watchdogPidFile = join(privateDir, "watchdog.pid");
try {
  const existingPidStr = (await readFile(watchdogPidFile, "utf8")).trim();
  const existingPid = parseInt(existingPidStr, 10);
  if (Number.isSafeInteger(existingPid) && existingPid !== process.pid) {
    const existingInfo = await processInfo(existingPid);
    if (existingInfo && existingInfo.name?.toLowerCase().includes("node") && existingInfo.command?.includes("entry-watchdog.mjs")) {
      console.log(`[Watchdog] 另一个看门狗实例已在后台运行 (PID: ${existingPid})，当前进程安全退出以避免冲突。`);
      process.exit(0);
    }
  }
} catch {}
await writeFile(watchdogPidFile, String(process.pid), { mode: 0o600 });
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    try {
      const cur = readFileSync(watchdogPidFile, "utf8").trim();
      if (cur === String(process.pid)) unlinkSync(watchdogPidFile);
    } catch {}
  });
}

const config = JSON.parse(await readFile(join(privateDir, "config.json"), "utf8"));
if (!config.cloudflared || !config.cloudflared.toLowerCase().endsWith("cloudflared.exe")) throw new Error("Cloudflared path required");
const statePath = join(privateDir, "tunnel.json");
const persist = async state => { await writeFile(statePath + ".tmp", JSON.stringify(state), { mode: 0o600 }); await rename(statePath + ".tmp", statePath); };
let initial = {};
try { initial = JSON.parse(await readFile(statePath, "utf8")); } catch (e) { if (e.code !== "ENOENT") throw e; }
if (initial.pid && !await processInfo(initial.pid)) { initial = {}; }
let stopped = false;
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { stopped = true; });

async function stopOwned(state) {
  const info = await processInfo(state.pid);
  if (!info) return true;
  if (info.name?.toLowerCase() !== "cloudflared.exe" || info.created !== state.created || info.path?.toLowerCase() !== config.cloudflared.toLowerCase() || !state.logPath || !info.command?.includes(state.logPath)) return false;
  process.kill(state.pid);
  for (let i = 0; i < 20; i++) { if (!await processInfo(state.pid)) return true; await delay(500); }
  return false;
}

async function start({ generation }) {
  const logPath = join(privateDir, "tunnel.log");
  await writeFile(logPath, "", { mode: 0o600 });
  const namedTunnel = config.tunnelName || null;
  const fixedUrl = config.tunnelUrl || "https://kamenradar.space";
  const args = namedTunnel
    ? ["--logfile", logPath, "--loglevel", "info", "tunnel", "run", namedTunnel]
    : ["tunnel", "--url", "http://localhost:3000", "--protocol", "http2", "--no-autoupdate", "--logfile", logPath, "--loglevel", "info"];
  const child = spawn(config.cloudflared, args, { windowsHide: true, stdio: "ignore" });
  await new Promise((ok, fail) => { child.once("spawn", ok); child.once("error", fail); });
  child.unref();
  let state;
  try {
    const info = await processInfo(child.pid);
    if (!info) throw new Error("Tunnel exited before initialization");
    state = { generation, pid: info.pid, created: info.created, logPath, url: namedTunnel ? fixedUrl : null };
    await persist(state);
  } catch (error) { child.kill(); throw error; }
  if (namedTunnel) {
    return state;
  }
  for (let i = 0; i < 60 && !stopped; i++) {
    const log = await readFile(logPath, "utf8");
    const url = (log.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/g) ?? []).at(-1);
    if (url && validTunnelUrl(url)) { state.url = url; await persist(state); return state; }
    await delay(1000);
  }
  return state;
}

let lastLog = "", publishFailure = false, lastNotifiedUrl = "";
async function note(message) {
  if (message === lastLog) return;
  lastLog = message;
  const log = join(privateDir, "watchdog.log");
  try { if ((await stat(log)).size > 1024 * 1024) await writeFile(log, ""); } catch {}
  await appendFile(log, `${new Date().toISOString()} ${message}\n`);
}

// 自动化磁盘空间巡检与防爆盘自愈守卫
let lastDiskCheck = 0;
async function checkDiskSpaceSafety() {
  const now = Date.now();
  if (now - lastDiskCheck < 300_000) return; // 每 5 分钟巡检一次
  lastDiskCheck = now;
  try {
    const stats = await statfs("C:\\");
    const freeBytes = stats.bavail * stats.bsize;
    const freeGB = freeBytes / (1024 * 1024 * 1024);

    if (freeGB < 1.0) {
      await note(`[DISK ALERT] C盘剩余空间告急: ${freeGB.toFixed(2)} GB，触发自动清理`);
      try {
        await run("docker", ["builder", "prune", "-f"], { windowsHide: true, timeout: 30_000, cwd: root });
        await run("powershell.exe", ["-NoProfile", "-Command", "Get-ChildItem -Path $env:TEMP -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-1) } | Remove-Item -Force -ErrorAction SilentlyContinue"], { windowsHide: true, timeout: 30_000, cwd: root });
        const postStats = await statfs("C:\\");
        const postFreeGB = (postStats.bavail * postStats.bsize) / (1024 * 1024 * 1024);
        await note(`[DISK RESCUED] 自动清理完成，当前剩余: ${postFreeGB.toFixed(2)} GB`);
        const topic = await getRescueTopic();
        await notifyRescueTopic(
          topic,
          "⚠️ 磁盘空间自动防护生效",
          `电脑 C 盘空间曾低于 1.0GB（仅剩 ${freeGB.toFixed(2)}GB），看门狗已自动清理 Docker 缓存与临时文件，当前恢复至 ${postFreeGB.toFixed(2)}GB。`,
          "high"
        );
      } catch (pruneErr) {
        await note(`[DISK ERROR] 自动清理失败: ${pruneErr.message}`);
      }
    }
  } catch {}
}

// 自动化 BullMQ 消息队列历史瘦身守护（每 12 小时自动清理已完成历史）
let lastQueueClean = Date.now(); // 启动时顺延，避免刚开机就密集执行
async function checkQueueMaintenance() {
  const now = Date.now();
  if (now - lastQueueClean < 12 * 3600_000) return; // 12 小时周期
  lastQueueClean = now;
  try {
    await note("[QUEUE] 开始执行定时 12 小时 BullMQ 队列终端历史清理...");
    const pnpm = pnpmInvocation([
      "--filter",
      "@tokusatsu/crawlers",
      "queue:maintain",
      "--",
      "--apply",
    ]);
    await run(pnpm.command, pnpm.args, {
      windowsHide: true,
      timeout: 120_000,
      cwd: root,
    });
    await note("[QUEUE] 定时队列历史清理完成，Redis 保持轻量。");
  } catch (err) {
    await note(`[QUEUE ERROR] 队列清理执行遇到异常: ${err.message}`);
  }
}

// 自动化 3 小时物理运存回收与无用后台安全清理守护（严格白名单防误杀）
let lastHygieneClean = Date.now();
async function checkPeriodicMemoryAndProcessHygiene() {
  const now = Date.now();
  if (now - lastHygieneClean < 3 * 3600_000) return; // 3 小时周期
  lastHygieneClean = now;
  try {
    await note("[HYGIENE] 开始执行定时 3 小时物理运存回收与无用后台安全清理...");
    const topic = await getRescueTopic();
    await executeSystemHygiene(topic);
    await note("[HYGIENE] 定时 3 小时物理运存回收与无用后台清理顺利完成。");
  } catch (err) {
    await note(`[HYGIENE ERROR] 定时运存清理遇到异常: ${err.message}`);
  }
}

// 自动化数据库历史死元组与过期日志瘦身守护（每 24 小时执行一次）
let lastDbClean = Date.now();
async function checkDatabaseMaintenance() {
  const now = Date.now();
  if (now - lastDbClean < 24 * 3600_000) return; // 24 小时周期
  lastDbClean = now;
  try {
    await note("[DB] 开始执行定时 24 小时数据库过期无效日志清理...");
    const deleteSql = "DELETE FROM ai_runs WHERE status = 'failed' AND started_at < NOW() - INTERVAL '7 days';";
    await run("docker", ["exec", "tokusatsu-monitor-postgres-1", "psql", "-U", "tokusatsu", "-d", "tokusatsu", "-c", deleteSql], {
      windowsHide: true,
      timeout: 60_000,
      cwd: root,
    });
    await note("[DB] 定时数据库日志清理完成。");
  } catch (err) {
    await note(`[DB ERROR] 数据库定时清理遇到异常: ${err.message}`);
  }
}

const supervisor = new TunnelSupervisor({
  probeLocal: () => probeApplication("http://localhost:3000"), probe: probeApplication, stopOwned, start, persist,
  isProcessAlive: async (pid) => Boolean(await processInfo(pid)),
  async repairLocal() {
    try {
      await run("docker", ["info"], { windowsHide: true, timeout: 5000, cwd: root });
    } catch {
      try {
        spawn("D:\\Programs\\DockerDesktop\\Docker Desktop.exe", [], { detached: true, stdio: "ignore" }).unref();
        await delay(20_000);
      } catch {}
    }
    // 启动停止的入口容器，避免破坏正常数据库
    await run("docker", ["compose", "--env-file", join(root, ".env"), "-f", join(root, "infrastructure/docker-compose.yml"), "start", "web", "gateway"], { windowsHide: true, timeout: 30_000, cwd: root });
  },
  async publish(state) {
    const publicState = { url: validTunnelUrl(state.url) ? state.url : null, generation: state.generation ?? 0, status: state.status, updatedAt: new Date().toISOString() };
    await writeFile(join(privateDir, "status.json"), JSON.stringify(publicState), { mode: 0o600 });
    await note(`${state.status} ${publicState.url ?? ""}`);
    if (publicState.url && state.status === "ready" && publicState.url !== lastNotifiedUrl) {
      lastNotifiedUrl = publicState.url;
      sendEntryNotification(publicState.url, root).catch(() => {});
    }
    if (!config.entryOrigin) return;
    const origin = new URL(config.entryOrigin);
    if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/") throw new Error("Invalid entry origin");
    const token = (await readFile(join(privateDir, "publish.token"), "utf8")).trim();
    try {
      const response = await fetch(new URL("/api/heartbeat", origin), { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(publicState), redirect: "error", signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error("publish failed");
      publishFailure = false;
    } catch { if (!publishFailure) { await note("Fixed entry publication unavailable; keeping current tunnel."); publishFailure = true; } }
  },
}, initial);

const stopRescue = startRescueListener(supervisor);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { stopped = true; stopRescue(); });

do {
  try {
    await supervisor.tick();
    await checkDiskSpaceSafety();
    await checkPeriodicMemoryAndProcessHygiene();
    await checkQueueMaintenance();
    await checkDatabaseMaintenance();
  }
  catch { await note("Recovery check failed; retrying without changing healthy services."); }
  if (process.argv.includes("--once")) break;
  const interval = Number.isSafeInteger(config.checkIntervalMs) && config.checkIntervalMs >= 5000 ? config.checkIntervalMs : 120_000;
  await delay(interval);
} while (!stopped);
