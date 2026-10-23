'use strict';
const {chromium}=require('../workers/crawlers/node_modules/playwright-core');
(async()=>{
 const browser=await chromium.connectOverCDP('http://127.0.0.1:9332',{timeout:5000});
 let page,asset;
 try{
  const context=browser.contexts()[0];
  asset=await context.newPage();
  await asset.setContent('<div style="width:300px;height:300px;background:#fff4ba;display:grid;place-items:center;font:24px sans-serif">自动填写验证，请勿发布</div>');
  const buffer=await asset.locator('div').screenshot();
  await asset.close();asset=null;
  page=await context.newPage();
  page.on('pageerror',error=>console.log('pageError',error.message.slice(0,200)));
  page.on('requestfailed',request=>console.log('requestFailed',new URL(request.url()).hostname,request.failure()?.errorText));
  await page.bringToFront();
  await page.goto('https://www.goofish.com/publish',{waitUntil:'domcontentloaded',timeout:20000});
  const file=page.locator('input[name="file"][type="file"]');
  await file.waitFor({state:'attached',timeout:20000}).catch(async()=>{
    const text=await page.locator('body').innerText();
    throw new Error(JSON.stringify({publishPath:new URL(page.url()).pathname,verification:/非法访问|安全验证|滑块验证|请完成验证/.test(text),loginFrame:page.frames().some(f=>/passport\.(goofish|taobao)\.com/.test(f.url())),inputs:await page.locator('input').count(),message:text.match(/.{0,15}(?:登录|服务异常|稍后重试|网络异常|发布).{0,30}/g)?.slice(-5)}));
  });
  await file.setInputFiles({name:'test-do-not-publish.png',mimeType:'image/png',buffer});
  await page.waitForTimeout(5000);
  console.log('uploadDOM',await file.evaluate(e=>e.closest('.ant-upload-wrapper')?.parentElement?.outerHTML.slice(0,16000) || e.parentElement.parentElement.parentElement.parentElement.outerHTML.slice(0,16000)));
  console.log('uploadFeedback',await page.locator('body').innerText().then(text=>text.match(/.{0,30}(?:上传失败|上传成功|上传中).{0,30}/g)));
  const remove=page.locator('[class*="delete"], [class*="remove"], [class*="close-icon"] ').filter({visible:true});
  console.log('removeControls',await remove.evaluateAll(nodes=>nodes.map(e=>e.outerHTML.slice(0,400))));
  if(await remove.count()===1)await remove.click();
 }finally{await page?.close().catch(()=>{});await asset?.close().catch(()=>{});await browser.close();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
