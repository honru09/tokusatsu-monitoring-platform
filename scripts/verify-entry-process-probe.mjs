import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import vm from 'node:vm';
const run=promisify(execFile);
const source=await readFile(new URL('./entry-watchdog.mjs',import.meta.url),'utf8');
const fn=source.slice(source.indexOf('async function processInfo('),source.indexOf('async function stopOwned('));
const state=JSON.parse(await readFile(new URL('../.private-entry/tunnel.json',import.meta.url),'utf8'));
try {const info=await vm.runInNewContext(`(${fn.trim()})`,{run,JSON,Number})(state.pid);console.log(JSON.stringify({probe:'ok',found:Boolean(info),name:info?.name}));}
catch(error){console.log(JSON.stringify({probe:'failed',code:error.code,stderr:error.stderr?.slice(0,1800)}));process.exitCode=1;}
