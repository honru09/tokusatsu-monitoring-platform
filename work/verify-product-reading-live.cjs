'use strict';
const fs=require('node:fs');
(async()=>{
 const base='http://localhost:3001';
 const before=await(await fetch(base+'/ai/resources')).json();
 const list=await(await fetch(base+'/resale')).json();
 const itemId=list.listings[0].itemId;
 const response=await fetch(`${base}/ai/items/${itemId}/read`,{method:'POST',signal:AbortSignal.timeout(100000)});
 const result=await response.json();
 const after=await(await fetch(base+'/ai/resources')).json();
 const report={status:response.status,model:result.model,facts:result.data?.observedFacts?.length,hasSummary:typeof result.data?.summaryZh==='string',missingFacts:result.data?.missingFacts?.length,spent:after.accountedTokens-before.accountedTokens,total:after.accountedTokens,remaining:after.remainingLocalBudget};
 fs.writeFileSync('work/zhipu/product-reading-live.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));
 if(!response.ok){console.log(JSON.stringify({message:result.message}));process.exitCode=1;}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
