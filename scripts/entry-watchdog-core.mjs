export function validTunnelUrl(value) {
  try {
    const url = new URL(value);
    const validHost =
      /^[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com$/.test(url.hostname) ||
      /^(?:[a-z0-9-]+\.)*kamenradar\.space$/.test(url.hostname);
    return (
      url.protocol === "https:" &&
      validHost &&
      !url.username &&
      !url.password &&
      !url.port &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}
export async function probeApplication(url, fetcher = fetch) {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 2000));
    }
    try {
      const response = await fetcher(`${url.replace(/\/$/, "")}/entry-health`, {
        redirect: "error",
        signal: AbortSignal.timeout(8000),
        cache: "no-store",
      });
      if (response.status === 429) return "limited";
      if (!response.ok) continue;
      const data = await response.json();
      if (data.app === "kamen-procurement" && data.ready === true)
        return "ready";
    } catch {
      if (
        url.includes("trycloudflare.com") ||
        url.includes("kamenradar.space")
      ) {
        try {
          const { execFile } = await import("node:child_process");
          const { promisify } = await import("node:util");
          const run = promisify(execFile);
          const { stdout } = await run(
            "curl.exe",
            [
              "-s",
              "--max-time",
              "4",
              "--doh-url",
              "https://1.1.1.1/dns-query",
              `${url.replace(/\/$/, "")}/entry-health`,
            ],
            { windowsHide: true, timeout: 5000 },
          );
          const data = JSON.parse(stdout);
          if (data.app === "kamen-procurement" && data.ready === true)
            return "ready";
        } catch {}
      }
    }
  }
  return "failed";
}
export class TunnelSupervisor {
  constructor(io, state = {}) {
    this.io = io;
    this.state = state;
    this.failures = 0;
    this.lastStart = 0;
    this.busy = false;
    this.backoff = 60_000;
    this.localFailures = 0;
    this.lastLocalRepair = 0;
  }
  async tick(now = Date.now()) {
    if (this.busy) return;
    this.busy = true;
    try {
      if ((await this.io.probeLocal()) !== "ready") {
        this.failures = 0;
        this.localFailures++;
        try {
          if (
            this.localFailures >= 3 &&
            now - this.lastLocalRepair >= 300_000 &&
            this.io.repairLocal
          ) {
            this.lastLocalRepair = now;
            await this.io.repairLocal();
          }
        } finally {
          await this.io.publish({ ...this.state, status: "app_unavailable" });
        }
        return;
      }
      this.localFailures = 0;
      const health = validTunnelUrl(this.state.url)
        ? await this.io.probe(this.state.url)
        : "failed";
      if (health === "ready") {
        this.failures = 0;
        this.backoff = 60_000;
        await this.io.publish({ ...this.state, status: "ready" });
        return;
      }
      if (health === "limited") {
        await this.io.publish({ ...this.state, status: "limited" });
        return;
      }
      this.failures++;
      if (
        this.io.isProcessAlive &&
        this.state.pid &&
        !(await this.io.isProcessAlive(this.state.pid))
      ) {
        this.failures = Math.max(this.failures, 3);
      }
      await this.io.publish({ ...this.state, status: "recovering" });
      if (
        this.state.pid &&
        (this.failures < 3 || now - this.lastStart < this.backoff)
      )
        return;
      if (this.state.pid && !(await this.io.stopOwned(this.state))) {
        await this.io.publish({ ...this.state, status: "ownership_conflict" });
        return;
      }
      this.lastStart = now;
      this.backoff = Math.min(this.backoff * 2, 15 * 60_000);
      this.state = await this.io.start({
        generation: Math.max(now, (this.state.generation ?? 0) + 1),
      });
      this.failures = 0;
      await this.io.persist(this.state);
      if (
        validTunnelUrl(this.state.url) &&
        (await this.io.probe(this.state.url)) === "ready"
      )
        await this.io.publish({ ...this.state, status: "ready" });
    } finally {
      this.busy = false;
    }
  }
}
