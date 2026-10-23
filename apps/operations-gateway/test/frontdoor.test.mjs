import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {createFrontdoor} from '../frontdoor.mjs';
test('frontdoor preserves the stable app entry and routes operations without exposing sessions',async()=>{
 const web=http.createServer((req,res)=>res.end('web:'+req.url));web.listen(0,'127.0.0.1');await once(web,'listening');
 const ops=http.createServer((req,res)=>{res.writeHead(401,{'set-cookie':'test=a; HttpOnly'});res.end('auth required');});ops.listen(0,'127.0.0.1');await once(ops,'listening');
 const front=createFrontdoor({web:{host:'127.0.0.1',port:web.address().port},operations:{host:'127.0.0.1',port:ops.address().port}});front.listen(0,'127.0.0.1');await once(front,'listening');
 const base=`http://127.0.0.1:${front.address().port}`;
 try{assert.equal(await(await fetch(base+'/api/health')).text(),'web:/api/health');const a=await fetch(base+'/operations-browser/api/status');assert.equal(a.status,401);assert.match(a.headers.get('set-cookie'),/HttpOnly/);const redirect=await fetch(base+'/operations-browser',{redirect:'manual'});assert.equal(redirect.status,308);assert.equal(redirect.headers.get('location'),'/operations-browser/');}
 finally{for(const server of [front,web,ops]){server.closeAllConnections();await new Promise(r=>server.close(r));}}
});
