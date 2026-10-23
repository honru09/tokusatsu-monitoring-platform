'use strict';
const fs=require('node:fs');
async function request(path,body){const response=await fetch('http://localhost:3001'+path,{method:body?'POST':'GET',headers:body?{'content-type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(100000)});const result=await response.json();return {status:response.status,result};}
(async()=>{
 const before=(await request('/ai/resources')).result;
 const input={texts:['中古品、傷あり。付属品なし。']};
 const translation=await request('/analysis/translate?costPolicy=free_only',input);
 console.log(JSON.stringify({translation}));
 if(translation.status<200 || translation.status>=300)throw new Error('Translation live check failed');
 const afterTranslation=(await request('/ai/resources')).result;
 const repeated=await request('/analysis/translate?costPolicy=free_only',input);
 const afterCache=(await request('/ai/resources')).result;
 console.log(JSON.stringify({cacheStatus:repeated.status,cacheSpent:afterCache.accountedTokens-afterTranslation.accountedTokens}));
 const chat=await request('/ai/chat',{message:'请用一句话说明中古品、傷あり、付属品なし的中文意思。',history:[]});
 console.log(JSON.stringify({chat}));
 const after=(await request('/ai/resources')).result;
 const report={beforeTokens:before.accountedTokens,afterTokens:after.accountedTokens,cacheSpent:afterCache.accountedTokens-afterTranslation.accountedTokens,translationStatus:translation.status,chatStatus:chat.status,remaining:after.remainingLocalBudget};
 fs.mkdirSync('work/zhipu',{recursive:true});fs.writeFileSync('work/zhipu/live-verification.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));
 if(chat.status<200 || chat.status>=300)process.exitCode=1;
})().catch(error=>{console.error(error.message);process.exitCode=1;});
