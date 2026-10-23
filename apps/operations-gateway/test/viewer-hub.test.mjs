import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { once } from "node:events";
import { WebSocket } from "ws";
import { createViewerHub } from "../viewer-hub.mjs";

test("two viewers coexist; atomic operator lease selects writable channel and hands off safely", async () => {
  let clock=Date.now(); const accepted=[];
  const write=net.createServer(s=>{accepted.push('write');s.write('WRITE');s.on('data',()=>{});});
  const read=net.createServer(s=>{accepted.push('read');s.write('READ');s.on('data',()=>{});});
  write.listen(0,'127.0.0.1');read.listen(0,'127.0.0.1');await Promise.all([once(write,'listening'),once(read,'listening')]);
  const sessions=new Map([['one',{name:'龙',expires:clock+900_000}],['two',{name:'润',expires:clock+900_000}]]);
  const hub=createViewerHub({browsers:{xiaohongshu:{host:'127.0.0.1',port:write.address().port,viewPort:read.address().port,label:'小红书'}},browserControl:async()=>({ok:true}),sessions,sessionFor:r=>sessions.has(r.headers.cookie)?{...sessions.get(r.headers.cookie),key:r.headers.cookie}:null,sameOrigin:r=>r.headers.origin==='https://fixture.invalid',now:()=>clock});
  const server=http.createServer();server.on('upgrade',hub.upgrade);server.listen(0,'127.0.0.1');await once(server,'listening');
  const clients=[];
  const a={key:'one',name:'龙'},b={key:'two',name:'润'},ca='client-a-123456789',cb='client-b-123456789';
  async function connect(session,client,path='xiaohongshu') {
    const ws=new WebSocket(`ws://127.0.0.1:${server.address().port}/operations-browser/ws/${path}?client=${client}`,{origin:'https://fixture.invalid',headers:{cookie:session.key}});
    clients.push(ws);const first=once(ws,'message');await once(ws,'open');return {ws,text:(await first)[0].toString()};
  }
  try {
    assert.equal(hub.choose(a,ca,'operator').status,200);
    assert.equal(hub.choose(b,cb,'operator').status,409);
    const op=await connect(a,ca),viewer=await connect(b,cb);
    assert.equal(op.text,'WRITE');assert.equal(viewer.text,'READ');assert.equal(hub.frames.size,2);
    const observerEvents=await connect(b,cb,'events');assert.equal(JSON.parse(observerEvents.text).operator.yours,false);
    const closed=once(op.ws,'close');
    hub.choose(a,ca,'observer');await closed;
    assert.equal(viewer.ws.readyState,WebSocket.OPEN);
    assert.equal(hub.choose(b,cb,'operator').status,200);
    assert.equal(hub.canOperate(a,ca),false);assert.equal(hub.canOperate(b,cb),true);
    clock+=60_001;
    assert.equal(hub.canOperate(b,cb),false);
    assert.equal(hub.choose(a,ca,'operator').status,200);
    hub.revoke('one');assert.equal(hub.canOperate(a,ca),false);
    assert.deepEqual(accepted,['write','read']);
  }finally{hub.close();for(const ws of clients)ws.terminate();await new Promise(r=>server.close(r));await Promise.all([new Promise(r=>write.close(r)),new Promise(r=>read.close(r))]);}
});
