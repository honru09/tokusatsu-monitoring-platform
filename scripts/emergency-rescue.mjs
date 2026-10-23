import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import http from "node:http";
import { probeApplication } from "./entry-watchdog-core.mjs";

const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function getRescueTopic() {
  try {
    const env = await readFile(join(root, ".env"), "utf8");
    const m = env.match(/^RESCUE_TOPIC=(.*)$/m);
    if (m && m[1].trim()) return m[1].trim().replace(/^["']|["']$/g, "");
  } catch {}
  return "kamen-rescue-wangxr-88";
}

export async function notifyRescueTopic(topic, title, message, priority = "default") {
  try {
    const prioMap = { urgent: 5, high: 4, default: 3, low: 2, min: 1 };
    const baseTags = priority === "high" || priority === "urgent" ? ["warning", "rotating_light"] : ["white_check_mark", "gear"];
    await fetch("https://ntfy.sh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic,
        title,
        message,
        priority: prioMap[priority] || 3,
        tags: ["from-laptop", ...baseTags],
      }),
    });
  } catch {}
}

export async function executeSystemRescue(topic, supervisor) {
  await notifyRescueTopic(topic, "⚡ 收到紧急重启指令", "电脑已接收到手机发出的强制重启信号，正在重置服务容器与隧道...", "high");

  let localOk = false;
  let publicOk = false;

  try {
    try {
      await run("docker", ["info"], { windowsHide: true, timeout: 5000, cwd: root });
    } catch {
      try {
        spawn("D:\\Programs\\DockerDesktop\\Docker Desktop.exe", [], { detached: true, stdio: "ignore" }).unref();
        await new Promise((r) => setTimeout(r, 20_000));
      } catch {}
    }
    // 1. 重启核心容器
    await run("docker", ["compose", "--env-file", join(root, ".env"), "-f", join(root, "infrastructure/docker-compose.yml"), "restart", "web", "gateway"], {
      windowsHide: true,
      timeout: 30_000,
      cwd: root,
    });
  } catch (err) {
    // 若 restart 失败，尝试 docker compose up -d
    try {
      await run("docker", ["compose", "--env-file", join(root, ".env"), "-f", join(root, "infrastructure/docker-compose.yml"), "up", "-d", "web", "gateway"], {
        windowsHide: true,
        timeout: 30_000,
        cwd: root,
      });
    } catch {}
  }

  // 2. 检查并强制重置隧道
  try {
    if (supervisor) {
      await supervisor.tick(Date.now() + 600_000);
    }
  } catch {}

  // 3. 等待并验证健康状态
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const probe = await probeApplication("https://kamenradar.space");
    if (probe === "ready") {
      publicOk = true;
      localOk = true;
      break;
    }
    const local = await probeApplication("http://localhost:3000");
    if (local === "ready") {
      localOk = true;
    }
  }

  const nowStr = new Date().toLocaleString("zh-CN", { hour12: false });
  if (publicOk) {
    await notifyRescueTopic(
      topic,
      "🎉 重启成功，已恢复上线",
      `所有服务已满血复活！\n访问网址：https://kamenradar.space\n完成时间：${nowStr}`,
      "default"
    );
  } else if (localOk) {
    await notifyRescueTopic(
      topic,
      "⚠️ 本地就绪，公网同步中",
      `本地服务已恢复，公网正在建立连接，请稍候 15 秒刷新：https://kamenradar.space\n时间：${nowStr}`,
      "default"
    );
  } else {
    await notifyRescueTopic(
      topic,
      "❌ 重启遇到异常",
      `服务尝试重启但健康检查尚未通过，请检查电脑是否连接外网。\n时间：${nowStr}`,
      "urgent"
    );
  }
}

export async function executeSystemHygiene(topic) {
  await notifyRescueTopic(
    topic,
    "🧹 正在执行运存与无用后台清理",
    "正在安全释放 WSL2 页面缓存、清理 Redis 碎片脏页、修剪废弃容器与回收孤儿进程...",
    "low"
  );

  const details = [];

  // 1. WSL2 页面缓存安全释放 (drop_caches)
  try {
    await run("wsl.exe", ["-d", "docker-desktop", "-u", "root", "sh", "-c", "echo 3 > /proc/sys/vm/drop_caches"], {
      windowsHide: true,
      timeout: 15_000,
      cwd: root,
    });
    details.push("WSL2 Linux 页面缓存已安全释放归还宿主机");
  } catch {}

  // 2. Redis jemalloc 内存碎片整理 (MEMORY PURGE)
  try {
    await run("docker", ["exec", "tokusatsu-monitor-redis-1", "redis-cli", "MEMORY", "PURGE"], {
      windowsHide: true,
      timeout: 10_000,
      cwd: root,
    });
    details.push("Redis jemalloc 内存碎片已压缩整理");
  } catch {}

  // 3. Docker 废弃临时容器与悬空镜像修剪（绝不触碰运行中容器）
  try {
    await run("docker", ["container", "prune", "-f"], { windowsHide: true, timeout: 15_000, cwd: root });
    await run("docker", ["image", "prune", "-f"], { windowsHide: true, timeout: 15_000, cwd: root });
    details.push("Docker 死亡废弃容器与悬空镜像已修剪");
  } catch {}

  // 4. PostgreSQL 超时孤儿空闲连接回收
  try {
    const terminateSql = "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state = 'idle' AND state_change < NOW() - INTERVAL '60 minutes' AND pid != pg_backend_pid();";
    await run("docker", ["exec", "tokusatsu-monitor-postgres-1", "psql", "-U", "tokusatsu", "-d", "tokusatsu", "-c", terminateSql], {
      windowsHide: true,
      timeout: 15_000,
      cwd: root,
    });
    details.push("数据库超时空闲连接已安全回收");
  } catch {}

  // 5. Windows 宿主机无用死进程安全清理（白名单保护）
  try {
    const psCleanupScript = `
$killed = 0
Get-Process -Name 'WerFault' -ErrorAction SilentlyContinue | ForEach-Object {
    Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
    $killed++
}
$allPids = [System.Collections.Generic.HashSet[int]]::new()
Get-Process | ForEach-Object { [void]$allPids.Add($_.Id) }
Get-CimInstance Win32_Process -Filter "Name = 'conhost.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
    if (-not $allPids.Contains($_.ParentProcessId)) {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        $killed++
    }
}
Get-Process -Name 'git', 'git-remote-https' -ErrorAction SilentlyContinue | Where-Object {
    (New-TimeSpan -Start $_.StartTime).TotalHours -gt 2
} | ForEach-Object {
    Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
    $killed++
}
`;
    await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", psCleanupScript], {
      windowsHide: true,
      timeout: 20_000,
      cwd: root,
    });
    details.push("Windows 宿主机孤儿/卡死进程检测清理完毕");
  } catch {}

  const nowStr = new Date().toLocaleString("zh-CN", { hour12: false });
  await notifyRescueTopic(
    topic,
    "✨ 运存与后台清理完成",
    `已成功执行：\n• ${details.join("\n• ")}\n时间：${nowStr}`,
    "default"
  );
}

export function startRescueListener(supervisor) {
  let active = true;
  let server = null;

  (async () => {
    const topic = await getRescueTopic();
    let lastMsgId = "";

    // 启动宿主机轻量专属应急控制台 HTTP 端口 (3008)
    try {
      server = http.createServer(async (req, res) => {
        // 设置全域 CORS
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");

        if (req.method === "OPTIONS") {
          res.writeHead(204);
          res.end();
          return;
        }

        const url = new URL(req.url, "http://localhost:3008");
        if (url.pathname === "/" || url.pathname === "/rescue" || url.pathname === "/index.html") {
          try {
            const html = await readFile(join(root, "scripts/rescue-console.html"), "utf8");
            res.writeHead(200, {
              "Content-Type": "text/html; charset=utf-8",
              "Cache-Control": "no-cache, no-store, must-revalidate",
            });
            res.end(html);
            return;
          } catch (e) {
            res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
            res.end("Internal Error loading console HTML");
            return;
          }
        }

        if (url.pathname === "/api/restart" && req.method === "POST") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, message: "Restart triggered" }));
          executeSystemRescue(topic, supervisor).catch(() => {});
          return;
        }

        if (url.pathname === "/api/cleanup" && req.method === "POST") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, message: "Cleanup triggered" }));
          executeSystemHygiene(topic).catch(() => {});
          return;
        }

        if (url.pathname === "/api/status") {
          const health = await probeApplication("https://kamenradar.space");
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, health, url: "https://kamenradar.space" }));
          return;
        }

        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not Found");
      });

      server.listen(3008, "0.0.0.0", () => {
        console.log("[Rescue] Local emergency HTTP server listening on port 3008");
      });
      server.on("error", () => {});
    } catch {}

    // 启动初始告知
    notifyRescueTopic(topic, "🟢 救援通道已就绪", `电脑端应急救援监听已启动，随时等待手机发号施令。\n专属域名：https://kamenradar.space`, "low").catch(() => {});

    // 采用 SSE 持续长连接事件流（零无谓网络轮询，毫秒级响应，超低功耗）
    let reconnectDelay = 2000;
    while (active) {
      const abortCtrl = new AbortController();
      try {
        const sseUrl = `https://ntfy.sh/${encodeURIComponent(topic)}/sse`;
        const response = await fetch(sseUrl, {
          headers: { "Accept": "text/event-stream" },
          signal: abortCtrl.signal,
        });

        if (response.ok && response.body) {
          reconnectDelay = 2000; // 连接成功，重置退避延迟
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          while (active) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const rawLine of lines) {
              const line = rawLine.trim();
              if (!line.startsWith("data:")) continue;
              const jsonStr = line.slice(5).trim();
              if (!jsonStr) continue;

              try {
                const data = JSON.parse(jsonStr);
                if (data.event === "message" && data.id !== lastMsgId) {
                  lastMsgId = data.id;
                  if (Array.isArray(data.tags) && data.tags.includes("from-laptop")) continue;
                  const msg = (data.message || "").trim();
                  if (/^(?:restart|reboot|\/restart|一键重启|重启)/i.test(msg)) {
                    await executeSystemRescue(topic, supervisor);
                  } else if (/^(?:cleanup|clean|memory|\/clean|运存清理|清理|释放)/i.test(msg)) {
                    await executeSystemHygiene(topic);
                  } else if (/^(?:status|\/status|状态|查询)/i.test(msg)) {
                    const health = await probeApplication("https://kamenradar.space");
                    notifyRescueTopic(
                      topic,
                      "📊 状态报告",
                      `当前公网状态：${health === "ready" ? "🟢 在线正常" : "🔴 异常中断"}\n网址：https://kamenradar.space\n时间：${new Date().toLocaleString("zh-CN")}`,
                      "low"
                    ).catch(() => {});
                  }
                }
              } catch {}
            }
          }
        }
      } catch (err) {
        // 网络短暂中断或流关闭，自动退避
      }

      if (active) {
        await new Promise((r) => setTimeout(r, reconnectDelay));
        reconnectDelay = Math.min(reconnectDelay * 1.5, 30_000); // 指数退避，最高 30 秒
      }
    }
  })();

  return () => {
    active = false;
    if (server) {
      try { server.close(); } catch {}
    }
  };
}
