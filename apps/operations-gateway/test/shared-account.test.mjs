import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { scryptSync } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { once } from "node:events";
import { createGateway } from "../server.mjs";
import { listenForHttpTest } from './listen.mjs';
test("shared account migration is idempotent and retains both existing sessions", async()=>{
  const dir=await mkdtemp(join(tmpdir(),'kamen-shared-account-'));
  let app;
  try{
    const salt='ab'.repeat(16), password='fixture-only-shared-password',hash=scryptSync(password,salt,64).toString('hex');
    await writeFile(join(dir,'accounts.json'),JSON.stringify([{id:'long',name:'龙',salt,hash},{id:'run',name:'润',salt,hash}]));
    const sessions=['long','run'].map((accountId,i)=>[String(i).repeat(64),{accountId,name:accountId,csrf:'fixture',expires:Date.now()+10_000}]);
    await writeFile(join(dir,'sessions.json'),JSON.stringify(sessions));
    const script=resolve(import.meta.dirname,'../migrate-shared-account.mjs');
    await promisify(execFile)(process.execPath,[script,dir]);
    await promisify(execFile)(process.execPath,[script,dir]);
    const accounts=JSON.parse(await readFile(join(dir,'accounts.json'),'utf8'));
    assert.equal(accounts.length,1);assert.equal(accounts[0].id,'shared');assert.equal(accounts[0].hash,hash);
    assert.equal(JSON.parse(await readFile(join(dir,'accounts.pre-shared.json'),'utf8')).length,2);
    await mkdir(join(dir,'materials'));
    app=await createGateway({authDir:dir,materialRoot:join(dir,'materials'),browserControl:async()=>({ok:true})});
    assert.equal(app.sessions.size,2);
    assert.ok([...app.sessions.values()].every(s=>s.accountId==='shared'));
    await listenForHttpTest(app.server);
    const base=`http://127.0.0.1:${app.server.address().port}`;
    const response=await fetch(base+'/operations-browser/api/login',{method:'POST',headers:{origin:base},body:JSON.stringify({password})});
    assert.equal(response.status,200);assert.equal((await response.json()).name,'共同运营');
  }finally{if(app){app.server.closeAllConnections();await new Promise(r=>app.server.close(r));}await rm(dir,{recursive:true,force:true});}
});
