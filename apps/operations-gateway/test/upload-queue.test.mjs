import {test} from 'node:test';import assert from 'node:assert/strict';import {setTimeout as delay} from 'node:timers/promises';
import {UploadQueue} from '../client/upload-queue.mjs';
async function settled(q){for(let i=0;i<100&&q.busy;i++)await delay(5);assert.equal(q.busy,false);}
test('batch failure does not stop later files, append and retry preserve per-file results',async()=>{
 const attempts=new Map(),completed=[];let running=0,maximum=0;
 const q=new UploadQueue({upload:async file=>{running++;maximum=Math.max(maximum,running);await delay(5);running--;const n=(attempts.get(file.name)??0)+1;attempts.set(file.name,n);if(file.name==='bad.png'&&n===1)throw Error('fixture failure');return {name:file.name};},onComplete:x=>completed.push(x.file.name)});
 q.add([{name:'one.png',size:1},{name:'bad.png',size:1},{name:'three.png',size:1}],'douyin');q.add([{name:'four.png',size:1}],'douyin');await settled(q);
 assert.equal(maximum,2);assert.equal(q.items.filter(x=>x.status==='done').length,3);assert.equal(q.items[1].status,'failed');q.retry(q.items[1].id);await settled(q);assert.equal(completed.length,4);
});
test('queued and active files can be canceled without blocking the queue',async()=>{
 const q=new UploadQueue({concurrency:1,upload:(_,__,{signal})=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>resolve({}),20);signal.addEventListener('abort',()=>{clearTimeout(timer);reject(Object.assign(Error('canceled'),{name:'AbortError'}));},{once:true});})});
 q.add([{name:'a',size:1},{name:'b',size:1},{name:'c',size:1}],'douyin');await delay(1);q.cancel(q.items[0].id);q.cancel(q.items[1].id);await settled(q);assert.deepEqual(q.items.map(x=>x.status),['canceled','canceled','done']);
});
