const {chromium}=require('../workers/crawlers/node_modules/playwright-core');
const fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try{
  const accounts=await(await fetch('http://localhost:3001/collaboration/accounts')).json();
  fs.mkdirSync('work/resale-ui',{recursive:true});
  for(const width of [1440,390]){
   const context=await browser.newContext({viewport:{width,height:960},reducedMotion:'reduce'});
   await context.addInitScript(actor=>localStorage.setItem('kamen-procurement-manager-v1',actor),accounts.accounts[0].id);
   const page=await context.newPage();
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto('http://localhost:3000/?workspace=resale',{waitUntil:'domcontentloaded'});
   const w=page.getByRole('region',{name:'闲鱼上架',exact:true});
   await page.screenshot({path:`work/resale-ui/loading-${width}.png`});
   await w.getByRole('button',{name:/HGシリーズ/}).waitFor();
   await page.screenshot({path:`work/resale-ui/real-list-${width}.png`});
   await w.getByRole('button',{name:/HGシリーズ/}).click();
   await w.getByLabel('标题',{exact:true}).waitFor();
   await page.screenshot({path:`work/resale-ui/real-editor-${width}.png`});
   console.log(JSON.stringify({width,overflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),errors,shortControls:await w.locator('button:visible,select:visible,input:not([type="checkbox"]):visible,summary:visible').evaluateAll(nodes=>nodes.filter(n=>n.getBoundingClientRect().height<43).map(n=>n.textContent?.slice(0,35)))}));
   await context.close();
  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
