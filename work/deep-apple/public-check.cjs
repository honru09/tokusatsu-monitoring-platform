const fs = require('node:fs');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const local = 'http://localhost:3000', remote = 'https://kamenradar.space';
async function get(url) {
 const response = await fetch(url, { signal: AbortSignal.timeout(25000), headers: {'Cache-Control':'no-cache'} });
 assert.equal(response.status,200,url);
 return response;
}
const bundlePaths = html => [...new Set([...html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^\"]+)"/g)].map(match=>match[1]).filter(url=>url.startsWith('/_next/static/')))];
(async()=>{
 const [localHtml,remoteHtml,health] = await Promise.all([get(`${local}/?workspace=resale`).then(r=>r.text()),get(`${remote}/?workspace=resale`).then(r=>r.text()),get(`${remote}/api/health`).then(r=>r.json())]);
 const paths=bundlePaths(localHtml),remotePaths=bundlePaths(remoteHtml);
 assert.deepEqual([...paths].sort(),[...remotePaths].sort());
 const assets = await Promise.all(paths.map(async path=>{
  const [a,b]=await Promise.all([get(local+path).then(r=>r.arrayBuffer()),get(remote+path).then(r=>r.arrayBuffer())]);
  const hash = value=>crypto.createHash('sha256').update(Buffer.from(value)).digest('hex');
  assert.equal(hash(a),hash(b),path);
  return {path,sha256:hash(a),bytes:a.byteLength,match:true};
 }));
 const result={checkedAt:new Date().toISOString(),local,remote,health,assets,allMatch:true};
 fs.writeFileSync('work/deep-apple/public-verification.json',JSON.stringify(result,null,2));
 console.log(JSON.stringify({health,assets:assets.length,allMatch:true}));
})().catch(e=>{console.error(e);process.exitCode=1;});
