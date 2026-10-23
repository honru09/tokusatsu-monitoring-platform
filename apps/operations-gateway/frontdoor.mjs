import http from 'node:http';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

function cleanHeaders(headers,upgrade=false){
 const remove=new Set(['connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade',...(headers.connection??'').split(',').map(x=>x.trim().toLowerCase())]);
 const result=Object.fromEntries(Object.entries(headers).filter(([key])=>!remove.has(key)));
 if(upgrade){result.connection='Upgrade';result.upgrade='websocket';}
 return result;
}
export function createFrontdoor({web={host:'web',port:3000},operations={host:'ops-gateway',port:8080}}={}){
 const server=http.createServer((req,res)=>{
  if(!req.url?.startsWith('/')||req.url.startsWith('//')){res.writeHead(400);res.end();return;}
  const path=new URL(req.url,'http://local').pathname;
  if(path==='/entry-health'){
   if(req.method!=='GET'){res.writeHead(405);res.end();return;}
   const probe=http.get({...web,path:'/api/health',timeout:5000},response=>{
    response.resume();const ready=response.statusCode===200;
    res.writeHead(ready?200:503,{'content-type':'application/json','cache-control':'no-store'});
    res.end(JSON.stringify({app:'kamen-procurement',ready}));
   });
   probe.on('timeout',()=>probe.destroy());
   probe.on('error',()=>{if(!res.headersSent){res.writeHead(503,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({app:'kamen-procurement',ready:false}));}});
   req.on('aborted',()=>probe.destroy());return;
  }
  if(path==='/operations-browser'){res.writeHead(308,{location:'/operations-browser/'});res.end();return;}
  const target=path.startsWith('/operations-browser/')?operations:web;
  const upstream=http.request({...target,path:req.url,method:req.method,headers:cleanHeaders(req.headers),timeout:280_000},response=>{
   res.writeHead(response.statusCode??502,cleanHeaders(response.headers));response.pipe(res);response.on('error',()=>res.destroy());
  });
  upstream.on('timeout',()=>upstream.destroy());
  upstream.on('error',()=>{if(!res.headersSent){res.writeHead(503,{'content-type':'text/plain; charset=utf-8','cache-control':'no-store'});res.end('服务暂未就绪，请稍后重试');}else res.destroy();});
  req.on('aborted',()=>upstream.destroy());res.on('close',()=>upstream.destroy());req.pipe(upstream);
 });
 server.requestTimeout=300_000;server.headersTimeout=30_000;
 server.on('upgrade',(req,socket,head)=>{
  if(!/^\/operations-browser\/ws\/(xiaohongshu|douyin|events)$/.test(new URL(req.url??'','http://local').pathname)){socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');return;}
  const upstream=http.request({...operations,path:req.url,method:'GET',headers:cleanHeaders(req.headers,true),timeout:10_000});
  upstream.on('upgrade',(response,remote,remoteHead)=>{
   socket.write('HTTP/1.1 101 Switching Protocols\r\n'+response.rawHeaders.reduce((lines,value,index,array)=>index%2?lines:lines+`${value}: ${array[index+1]}\r\n`,'')+'\r\n');
   if(remoteHead.length)socket.write(remoteHead);if(head.length)remote.write(head);
   remote.pipe(socket);socket.pipe(remote);socket.on('error',()=>remote.destroy());remote.on('error',()=>socket.destroy());socket.on('close',()=>remote.destroy());remote.on('close',()=>socket.destroy());
  });
  upstream.on('response',response=>{response.resume();socket.end(`HTTP/1.1 ${response.statusCode??503} Connection rejected\r\nConnection: close\r\n\r\n`);});
  upstream.on('error',()=>socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n'));
  upstream.on('timeout',()=>upstream.destroy());upstream.end();
 });
 return server;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){const server=createFrontdoor();server.listen(3000,'0.0.0.0');for(const s of ['SIGTERM','SIGINT'])process.on(s,()=>server.close(()=>process.exit(0)));}
