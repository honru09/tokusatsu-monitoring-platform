const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers });
export function validTarget(value) {
  try { const u = new URL(value); return u.protocol === "https:" && /^[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com$/.test(u.hostname) && !u.username && !u.password && !u.port && u.pathname === "/" && !u.search && !u.hash; } catch { return false; }
}
async function authorized(request, env) {
  if (typeof env.ENTRY_PUBLISH_TOKEN !== "string" || env.ENTRY_PUBLISH_TOKEN.length < 32) return false;
  const encoder = new TextEncoder();
  const a = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(request.headers.get("authorization") ?? "")));
  const b = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(`Bearer ${env.ENTRY_PUBLISH_TOKEN}`)));
  let mismatch = 0; for (let i=0;i<a.length;i++) mismatch |= a[i]^b[i]; return mismatch === 0;
}
export class EntryState {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; this.check = null; this.cached = null; }
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/api/heartbeat" && request.method === "POST") {
      if (!await authorized(request, this.env)) return json({ error: "Unauthorized" }, 403);
      if (Number(request.headers.get("content-length") ?? 0) > 2048) return json({ error: "Too large" }, 413);
      let input;
      try { const text = await request.text(); if (text.length > 2048) return json({ error: "Too large" }, 413); input = JSON.parse(text); } catch { return json({ error: "Invalid request" }, 400); }
      if (!Number.isSafeInteger(input.generation) || input.generation < 1 || !["ready", "recovering", "app_unavailable", "limited", "ownership_conflict"].includes(input.status) || (input.url !== null && !validTarget(input.url)) || (input.status === "ready" && !validTarget(input.url))) return json({ error: "Invalid state" }, 400);
      return this.ctx.storage.transaction(async storage => {
        const previous = await storage.get("state");
        if (previous && (input.generation < previous.generation || (input.generation === previous.generation && previous.url !== null && input.url !== previous.url))) return json({ error: "Stale generation" }, 409);
        const state = { url: input.url, generation: input.generation, status: input.status, receivedAt: Date.now() };
        await storage.put("state", state);
        if (this.cached?.generation !== state.generation || state.status !== "ready") this.cached = null;
        return json({ ok: true });
      });
    }
    if (path !== "/api/status" || request.method !== "GET") return json({ error: "Not found" }, 404);
    const state = await this.ctx.storage.get("state");
    if (!state) return json({ status: "unconfigured" });
    if (Date.now()-state.receivedAt > 150_000) return json({ status: "host_offline", updatedAt: state.receivedAt });
    if (state.status !== "ready" || !validTarget(state.url)) return json({ status: state.status === "ownership_conflict" ? "recovering" : state.status });
    if (this.cached?.generation === state.generation && Date.now()-this.cached.at < 8000) return json(this.cached.result);
    if (!this.check || this.check.generation !== state.generation) {
      const pending = { generation: state.generation };
      pending.promise = (async () => {
        let ready = false;
        try {
          const response = await fetch(new URL("/entry-health", state.url), { redirect: "error", signal: AbortSignal.timeout(5000) });
          const info = response.ok ? await response.json() : null;
          ready = info?.app === "kamen-procurement" && info.ready === true;
        } catch {}
        const latest = await this.ctx.storage.get("state");
        if (!latest || latest.generation !== state.generation || latest.status !== "ready" || Date.now()-latest.receivedAt > 150_000) return { status: "recovering" };
        const result = ready ? { status: "ready", url: state.url, generation: state.generation } : { status: "recovering" };
        this.cached = { generation: state.generation, at: Date.now(), result };
        return result;
      })().finally(() => { if (this.check === pending) this.check = null; });
      this.check = pending;
    }
    return json(await this.check.promise);
  }
}
export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === "/api/status" || path === "/api/heartbeat") {
      const id = env.ENTRY_STATE.idFromName("kamen-entry");
      return env.ENTRY_STATE.get(id).fetch(request);
    }
    if (path.startsWith("/api/")) return json({ error: "Not found" }, 404);
    // Static entrance UI is added after design-mode confirmation.
    return new Response("入口尚未发布", { status: 503, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  },
};
