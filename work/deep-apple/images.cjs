const {chromium}=require('../../workers/crawlers/node_modules/playwright-core');
const fs=require('node:fs');
(async()=>{
 const base='http://localhost:3000';
 const accounts=await(await fetch(`${base}/backend/collaboration/accounts`)).json();
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  await page.addInitScript(id=>localStorage.setItem('kamen-procurement-manager-v1',id),accounts.accounts[0].id);
  const failures=[];
  page.on('requestfailed',r=>{if(r.resourceType()==='image')failures.push({url:r.url(),error:r.failure()?.errorText});});
  await page.route('**/*',route=>{
    const r=route.request(),url=new URL(r.url());
    if(!['GET','HEAD','OPTIONS'].includes(r.method())||/\/analysis(?:\/|$)|\/ai\/(chat|translate|read|analyze)/.test(url.pathname))return route.fulfill({status:200,contentType:'application/json',body:'{}'});
    return route.continue();
  });
  await page.goto(`${base}/?workspace=catalog`);
  await page.locator('.js-product-card:visible').first().waitFor();
  await page.waitForTimeout(10000);
  const images=await page.locator('img').evaluateAll(nodes=>nodes.map(img=>{
    const r=img.getBoundingClientRect();
    return {alt:img.alt,src:img.currentSrc||img.src,complete:img.complete,naturalWidth:img.naturalWidth,loading:img.loading,visible:img.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}),rect:{x:r.x,y:r.y,width:r.width,height:r.height}};
  }));
  fs.writeFileSync('work/deep-apple/image-diagnosis.json',JSON.stringify({images,failures},null,2));
  console.log(JSON.stringify({images:images.filter(i=>i.rect.height>0&&i.rect.y<1000&&i.rect.y+i.rect.height>0),failures},null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
