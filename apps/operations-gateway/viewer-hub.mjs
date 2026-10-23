import net from "node:net";
import { WebSocketServer, WebSocket } from "ws";

export const validClientId = value => typeof value === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(value);
export function createViewerHub({ browsers, browserControl, sessions, sessionFor, sameOrigin, now = Date.now }) {
  const frames = new Set(), events = new Set(), pending = new Set();
  let closed=false;
  const idleTimers = new Map();
  const restoring = new Map();
  const parking = new Map();
  function idle(platform) {
    if(closed)return;
    clearTimeout(idleTimers.get(platform));
    if ([...frames].some(c=>c.platform===platform)) return;
    const timer=setTimeout(()=>{
      idleTimers.delete(platform);
      if(![...frames].some(c=>c.platform===platform) && ![...pending].some(key=>key.endsWith(`:${platform}`))) {
        const task=browserControl(platform,"park").catch(()=>{}).finally(()=>parking.delete(platform));
        parking.set(platform,task);
      }
    },20_000);timer.unref();idleTimers.set(platform,timer);
  }
  for(const platform of Object.keys(browsers))idle(platform);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 ** 2, perMessageDeflate: false });
  let lease = null;
  const owner = (s, clientId) => lease?.sessionKey === s.key && lease?.clientId === clientId;
  const validSession = c => sessions.has(c.sessionKey) && sessions.get(c.sessionKey).expires > now();
  const closeFrame = (c, code = 4001) => { c.tcp?.destroy(); c.ws.close(code); frames.delete(c); };
  function release() {
    lease = null;
    // Writable sockets are destroyed before anyone else can acquire control.
    for (const c of frames) if (c.operator) closeFrame(c);
  }
  function expire() { if (lease && (lease.expires <= now() || !validSession(lease))) release(); }
  function status(s, clientId) {
    expire();
    return {
      role: owner(s, clientId) ? "operator" : "observer",
      operator: lease ? { name: lease.name, yours: owner(s, clientId) } : null,
      browsers: Object.entries(browsers).map(([id,b]) => ({ id, label:b.label, viewers:[...frames].filter(c=>c.platform===id).length, inUseBy:lease?.name??null, ownSession:owner(s, clientId) })),
    };
  }
  function broadcast() {
    for (const c of events) if (c.ws.readyState === WebSocket.OPEN && validSession(c)) c.ws.send(JSON.stringify({ type:"status", ...status({ key:c.sessionKey }, c.clientId) }));
  }
  function choose(s, clientId, role) {
    if (!validClientId(clientId) || !["operator", "observer"].includes(role)) return { status:400, error:"角色请求无效" };
    expire();
    if (role === "operator") {
      if (lease && !owner(s, clientId)) return { status:409, error:`${lease.name}正在操作`, ...status(s,clientId) };
      lease = { sessionKey:s.key, clientId, name:s.name, expires:now()+60_000 };
    } else if (owner(s,clientId)) release();
    for (const c of frames) if (c.sessionKey===s.key && c.clientId===clientId && c.operator !== owner(s,clientId)) closeFrame(c);
    broadcast();
    return { status:200, ...status(s,clientId) };
  }
  function canOperate(s,clientId) { expire(); return validClientId(clientId) && owner(s,clientId); }
  function revoke(sessionKey) {
    if (lease?.sessionKey===sessionKey) release();
    for (const c of frames) if(c.sessionKey===sessionKey) closeFrame(c,1008);
    for (const c of events) if(c.sessionKey===sessionKey)c.ws.close(1008);
    broadcast();
  }
  async function upgrade(req,socket,head) {
    const url=new URL(req.url,"http://internal"),s=sessionFor(req),clientId=url.searchParams.get("client");
    const platform=url.pathname.match(/^\/operations-browser\/ws\/(xiaohongshu|douyin)$/)?.[1];
    const isEvents=url.pathname==="/operations-browser/ws/events";
    socket.on("error",()=>{});
    if(!s || !sameOrigin(req) || !validClientId(clientId) || (!platform&&!isEvents)){socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");return;}
    if(isEvents) {
      if(events.size>=12){socket.end("HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n");return;}
      wss.handleUpgrade(req,socket,head,ws=>{
        for(const previous of events)if(previous.sessionKey===s.key&&previous.clientId===clientId){previous.ws.close(4002);events.delete(previous);}
        const c={ws,sessionKey:s.key,clientId,alive:true};events.add(c);
        ws.on("pong",()=>{c.alive=true;});
        ws.on("message",data=>{
          if(!validSession(c)){ws.close(1008);return;}
          if(data.length>512){ws.close(1009);return;}
          try {
            const input=JSON.parse(data.toString());
            if(input.type!=="presence")return;
            if(owner(s,clientId))lease.expires=input.active===true?now()+60_000:Math.min(lease.expires,now()+30_000);
          }catch{ws.close(1003);}
        });
        ws.on("close",()=>{events.delete(c);if(owner(s,clientId))lease.expires=Math.min(lease.expires,now()+10_000);});
        ws.on("error",()=>ws.close());
        broadcast();
      });return;
    }
    const key=`${s.key}:${clientId}:${platform}`;
    if(pending.has(key)||[...frames].some(c=>c.key===key)||frames.size+pending.size>=6){socket.end("HTTP/1.1 409 Conflict\r\nConnection: close\r\n\r\n");return;}
    pending.add(key);
    clearTimeout(idleTimers.get(platform));idleTimers.delete(platform);
    try{
      // Watching a second time must not steal window focus from the operator.
      if(![...frames].some(c=>c.platform===platform)) {
        if(parking.has(platform))await parking.get(platform);
        if(!restoring.has(platform))restoring.set(platform,browserControl(platform,"restore").finally(()=>restoring.delete(platform)));
        await restoring.get(platform);
      }
      if(socket.destroyed||!sessions.has(s.key)||s.expires<=now()){socket.destroy();return;}
      wss.handleUpgrade(req,socket,head,ws=>{
        const operator=canOperate(s,clientId), browser=browsers[platform];
        const tcp=net.connect(operator?browser.port:(browser.viewPort??5902),browser.host);
        const c={key,ws,tcp,operator,clientId,platform,sessionKey:s.key,alive:true};frames.add(c);broadcast();
        ws.on("pong",()=>{c.alive=true;});
        tcp.setNoDelay(true);
        tcp.on("data",data=>{
          if(ws.readyState!==WebSocket.OPEN)return;
          // Don't queue seconds of stale frames on slow mobile links.
          if(ws.bufferedAmount>2*1024**2){closeFrame(c,1013);return;}
          ws.send(data,{binary:true});
        });
        ws.on("message",data=>{
          if(!validSession(c)||(c.operator&&!canOperate(s,clientId))){closeFrame(c,1008);return;}
          if(tcp.writableLength>1024**2){closeFrame(c,1013);return;}
          tcp.write(data);
        });
        const cleanup=()=>{tcp.destroy();frames.delete(c);broadcast();idle(platform);};
        tcp.on("error",()=>ws.close(1011,"浏览器尚未就绪"));tcp.on("close",()=>ws.close());
        ws.on("close",cleanup);ws.on("error",cleanup);
      });
    }catch{socket.end("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");}
    finally{pending.delete(key);if(![...frames].some(c=>c.platform===platform))idle(platform);}
  }
  const timer=setInterval(()=>{
    const previous=lease;expire();if(previous&&!lease)broadcast();
    for(const c of [...events,...frames]) {
      if(!validSession(c)){c.ws.close(1008);continue;}
      if(!c.alive){c.ws.terminate();continue;}
      c.alive=false;if(c.ws.readyState===WebSocket.OPEN)c.ws.ping();
    }
  },10_000);timer.unref();
  function close(){closed=true;clearInterval(timer);for(const timer of idleTimers.values())clearTimeout(timer);for(const c of frames){c.tcp.destroy();c.ws.terminate();}for(const c of events)c.ws.terminate();wss.close();}
  return {status,choose,canOperate,revoke,upgrade,close,frames,events};
}
