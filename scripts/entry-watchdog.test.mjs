import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TunnelSupervisor,
  validTunnelUrl,
  probeApplication,
} from "./entry-watchdog-core.mjs";
const url = "https://fixture-valid-entry.trycloudflare.com";
function setup(health = "ready") {
  const calls = [],
    state = { url, pid: 12, generation: 1 };
  const io = {
    probeLocal: async () => "ready",
    probe: async () => health,
    stopOwned: async () => {
      calls.push("stop");
      return true;
    },
    start: async ({ generation }) => {
      calls.push("start");
      return { ...state, generation };
    },
    persist: async () => {},
    publish: async (s) => calls.push(s.status),
  };
  return { calls, io, supervisor: new TunnelSupervisor(io, state) };
}
test("ten healthy checks reuse tunnel with no starts", async () => {
  const t = setup();
  for (let i = 0; i < 10; i++) await t.supervisor.tick();
  assert.equal(t.calls.filter((c) => c === "ready").length, 10);
  assert.ok(!t.calls.includes("start"));
});
test("three failures cause exactly one serialized restart then backoff", async () => {
  const t = setup("failed");
  for (let i = 0; i < 3; i++) await t.supervisor.tick(300_000 + i);
  assert.equal(t.calls.filter((c) => c === "start").length, 1);
  await Promise.all(
    Array.from({ length: 10 }, () => t.supervisor.tick(300_010)),
  );
  assert.equal(t.calls.filter((c) => c === "start").length, 1);
});
test("local outage, 429 and ownership conflict never kill unrelated processes", async () => {
  for (const mode of ["local", "limited", "owner"]) {
    const t = setup(mode === "limited" ? "limited" : "failed");
    if (mode === "local") t.io.probeLocal = async () => "failed";
    if (mode === "owner") t.io.stopOwned = async () => false;
    for (let i = 0; i < 5; i++) await t.supervisor.tick(900_000);
    assert.ok(!t.calls.includes("start"));
  }
});
test("only application-ready JSON is accepted", async () => {
  assert.equal(validTunnelUrl(url), true);
  for (const u of [
    "https://evil.com",
    "https://foo.trycloudflare.com.evil.com",
    "http://foo.trycloudflare.com",
    "https://user:pass@foo.trycloudflare.com",
    "https://foo.trycloudflare.com/?url=evil",
    "https://foo.trycloudflare.com:444",
  ])
    assert.equal(validTunnelUrl(u), false);
  assert.equal(
    await probeApplication(url, async () => new Response("<html>error</html>")),
    "failed",
  );
  assert.equal(
    await probeApplication(url, async () =>
      Response.json({ app: "kamen-procurement", ready: true }),
    ),
    "ready",
  );
  assert.equal(
    await probeApplication(url, async () => new Response("", { status: 429 })),
    "limited",
  );
});
test("stopped app entry gets one start attempt after three failures, not a tunnel restart", async () => {
  const t = setup();
  t.io.probeLocal = async () => "failed";
  t.io.repairLocal = async () => t.calls.push("repair-local");
  for (let i = 0; i < 10; i++) await t.supervisor.tick(900_000 + i);
  assert.equal(t.calls.filter((x) => x === "repair-local").length, 1);
  assert.ok(!t.calls.includes("start"));
});
test("failed local repair still publishes an outage heartbeat and keeps the repair cooldown", async () => {
  const t = setup();
  t.io.probeLocal = async () => "failed";
  t.io.repairLocal = async () => {
    t.calls.push("repair-local");
    throw new Error("Docker engine unavailable");
  };
  await t.supervisor.tick(900_000);
  await t.supervisor.tick(900_001);
  await assert.rejects(t.supervisor.tick(900_002), /Docker engine unavailable/);
  assert.equal(t.calls.filter((call) => call === "app_unavailable").length, 3);
  assert.equal(t.supervisor.busy, false);
  await t.supervisor.tick(900_003);
  assert.equal(t.calls.filter((call) => call === "repair-local").length, 1);
  assert.equal(t.calls.filter((call) => call === "app_unavailable").length, 4);
  assert.ok(!t.calls.includes("start"));
});
