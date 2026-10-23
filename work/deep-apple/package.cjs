const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const output = 'C:/Users/wangxr/Documents/Codex/2026-10-09/xian/outputs/deep-apple';
const read = file => JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const layout = read('work/apple-motion/deep-production/verification.json');
const shared = read('work/deep-apple/production/interaction-check.json');
const transactions = read('work/deep-apple/transactions-production/report.json');
const resale = read('work/deep-apple/resale-production/verification.json');
const operations = read('work/deep-apple/operations-production/verification.json');
const contrast = read('work/deep-apple/operations-production/contrast.json');
const keyboard = read('work/deep-apple/operations-production/contrast-keyboard-verification.json');
const finalContrast = read('work/deep-apple/operations-production/final-contrast-keyboard-summary.json');
const publicCheck = read('work/deep-apple/public-verification.json');
const demo = read('work/deep-apple/demo/verification.json');
assert.equal(layout.pages.length,55);
assert.equal(layout.interactions.length,5);
assert.deepEqual(layout.errors,[]);
assert.deepEqual(layout.consoleErrors,[]);
assert.equal(layout.resaleUnchanged,true);
assert.equal(layout.realWritesAndModelCalls,0);
assert.equal(shared.runs.reduce((sum,run)=>sum+run.checks.length,0),21);
for(const run of shared.runs){assert.deepEqual(run.errors,[]);assert.deepEqual(run.consoleErrors,[]);}
assert.equal(transactions.reduce((sum,run)=>sum+run.flows.length,0),30);
assert.equal(operations.checks.length,33);
assert.equal(resale.runs.length,3);
for(const run of resale.runs){assert.deepEqual(run.pageErrors,[]);assert.deepEqual(run.hydrationErrors,[]);}
assert.equal(finalContrast.samples,27);
assert.equal(finalContrast.passed,27);
assert.deepEqual(finalContrast.failed,[]);
assert.equal(finalContrast.keyboard,12);
assert.deepEqual(finalContrast.errors,[]);
assert.equal(finalContrast.forwardedMutations,0);
assert.equal(publicCheck.allMatch,true);
assert.equal(publicCheck.assets.length,13);
assert.equal(publicCheck.health.status,'ok');
assert.ok(new Date(demo.capturedAt)>new Date(publicCheck.checkedAt),'recording must start after final deployment validation');
assert.equal(demo.realBusinessWrites,0);
assert.equal(demo.realModels,0);
assert.equal(demo.runs.length,2);
for(const run of demo.runs) {
 assert.deepEqual(run.pageErrors,[]);
 assert.equal(run.consoleErrors.length,run.expectedFixture409);
 assert.ok(run.consoleErrors.every(error=>/409/.test(error)));
 assert.ok(run.durationSeconds>=30);
}
const evidence = path.join(output,'evidence');
fs.mkdirSync(evidence,{recursive:true});
for(const [name,data] of Object.entries({layout,shared,transactions,resale,operations,contrast,keyboard,public:publicCheck,recording:demo}))fs.writeFileSync(path.join(evidence,`${name}.json`),JSON.stringify(data,null,2));
for(const [source,target] of [
 ['docs/UI_APPLE_DEPTH_UPGRADE_2026-10-09.md','验收报告.md'],
 ['work/deep-apple/operations-production/contrast-summary.md','对比度采样.md'],
 ['work/deep-apple/demo/desktop.webm','桌面动效.webm'],
 ['work/deep-apple/demo/mobile.webm','手机动效.webm'],
 ['work/deep-apple/demo/desktop-first-frame.png','桌面工作台.png'],
 ['work/deep-apple/demo/mobile-resale-preview.png','手机闲鱼预览.png'],
 ['work/deep-apple/demo/mobile-sheet-drag.png','手机抽屉拖拽.png'],
])fs.copyFileSync(path.join(root,source),path.join(output,target));
const summary={
 packagedAt:new Date().toISOString(),url:'https://kamenradar.space/?workspace=resale',
 layoutPages:55,globalInteractionGroups:5,sharedChecks:21,transactionFlows:30,
 resaleScenarios:resale.runs.reduce((sum,run)=>sum+run.passed.length,0),operationsChecks:33,
 contrastSamples:27,minimumContrast:Math.min(...contrast.rows.map(row=>row.minimumRatio)),keyboardChecks:12,
 publicAssets:13,realBusinessWrites:0,realModelCalls:0,
 videos:demo.runs.map(run=>({label:run.label,durationSeconds:run.durationSeconds,format:run.format})),
};
fs.writeFileSync(path.join(output,'verification-summary.json'),JSON.stringify(summary,null,2));
console.log(JSON.stringify({output,...summary}));
