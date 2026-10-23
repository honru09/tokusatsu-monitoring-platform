import { test } from "node:test";
import assert from "node:assert/strict";
import { EntryState, validTarget } from "./worker.mjs";
const token = "test-only-entry-publisher-token-1234567890";
const target = "https://fixture-stable-entry.trycloudflare.com";
function fixture() {
  const values = new Map();
  const storage = { get: async key => values.get(key), put: async (key,value) => values.set(key,value), transaction: async fn => fn(storage) };
  const entry = new EntryState({ storage }, { ENTRY_PUBLISH_TOKEN: token });
  const publish = (value, credential=token) => entry.fetch(new Request("https://entry.invalid/api/heartbeat", { method:"POST",headers:{authorization:`Bearer ${credential}`},body:JSON.stringify(value) }));
  return {entry,values,publish,status:()=>entry.fetch(new Request("https://entry.invalid/api/status"))};
}
test("publisher auth, URL allowlist and generations protect public state", async () => {
  const f=fixture(), value={url:target,generation:10,status:'ready'};
  assert.equal((await f.publish(value,'invalid')).status,403);
  assert.equal((await f.publish({...value,url:'https://127.0.0.1'})).status,400);
  assert.equal((await f.publish(value)).status,200);
  assert.equal((await f.publish({...value,generation:9})).status,409);
  assert.equal((await f.publish({...value,url:'https://another.trycloudflare.com'})).status,409);
  for(const url of ['https://evil.com','https://user@ok.trycloudflare.com','https://ok.trycloudflare.com/path','https://ok.trycloudflare.com?next=evil'])assert.equal(validTarget(url),false);
});
test("status handles unconfigured/offline and deduplicates concurrent health checks", async () => {
  const f=fixture();assert.equal((await(await f.status()).json()).status,'unconfigured');
  await f.publish({url:target,generation:10,status:'ready'});
  const original=globalThis.fetch;let count=0;
  globalThis.fetch=async()=>{count++;return Response.json({app:'kamen-procurement',ready:true})};
  try {
    const results=await Promise.all(Array.from({length:10},()=>f.status()));
    assert.equal(count,1);assert.equal((await results[0].json()).url,target);
    f.values.get('state').receivedAt=Date.now()-180_000;
    assert.equal((await(await f.status()).json()).status,'host_offline');
  } finally{globalThis.fetch=original;}
});
test("a generation change during probe cannot redirect to a stale tunnel", async()=>{
  const f=fixture();await f.publish({url:target,generation:10,status:'ready'});
  const original=globalThis.fetch;
  globalThis.fetch=async()=>{f.values.set('state',{url:'https://new-entry.trycloudflare.com',generation:11,status:'ready',receivedAt:Date.now()});return Response.json({app:'kamen-procurement',ready:true});};
  try{const result=await(await f.status()).json();assert.equal(result.status,'recovering');assert.equal(result.url,undefined);}finally{globalThis.fetch=original;}
});
