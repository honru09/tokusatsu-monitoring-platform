'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {publishInput,createPublishPreparer,fillPublishForm}=require('./publish-form.cjs');
const {chromium}=require('../../workers/crawlers/node_modules/playwright-core');
const input=()=>({id:'test-only',version:1,title:'测试商品',description:'此数据仅用于功能验证',deliveryText:'测试交付',priceCny:12.5,imageUrls:['https://static.mercdn.net/item/test.jpg'],shippingMode:'fixed',shippingFeeCny:8,locationText:''});
test('rejects oversized official descriptions and invalid shipping before opening a page',()=>{
 assert.throws(()=>publishInput({...input(),description:'字'.repeat(1500)}),/1500/);
 assert.throws(()=>publishInput({...input(),shippingFeeCny:-1}),/运费/);
 assert.throws(()=>publishInput({...input(),imageUrls:[]}),/图片/);
});
test('reopening a saved version preserves the existing page, while a new version or disconnect starts fresh',async()=>{
 let created=0,filled=0;
 const page=()=>({isClosed:()=>false,bringToFront:async()=>{},goto:async()=>{}});
 const prepare=createPublishPreparer({getStatus:async()=>({authenticated:true,accountLabel:'test'}),createPage:async()=>{created++;return page();},fillForm:async()=>{filled++;return {state:'prepared',message:'fixture'};}});
 await prepare(input());await prepare(input());assert.equal(created,1);assert.equal(filled,1);
 await prepare({...input(),version:2});assert.equal(created,2);
 prepare.reset();await prepare({...input(),version:2});assert.equal(created,3);
});
test('expired sessions do not fill pages and failed uploads remain available for manual correction',async()=>{
 let authenticated=false,created=0;
 const prepare=createPublishPreparer({getStatus:async()=>({authenticated,accountLabel:'test'}),createPage:async()=>{created++;return {isClosed:()=>false,bringToFront:async()=>{},goto:async()=>{}};},fillForm:async()=>{throw new Error('图片尚未上传完成');}});
 assert.equal((await prepare(input())).state,'login_required');assert.equal(created,0);
 authenticated=true;assert.equal((await prepare(input())).state,'manual_required');
 assert.equal((await prepare(input())).state,'manual_required');assert.equal(created,1);
});
test('fills real controls, waits for accepted thumbnails and never submits the official form',async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 const originalFetch=global.fetch;
 try{
  const page=await browser.newPage();
  await page.setContent('<div style="width:160px;height:160px;background:#fff4ba">仅验证，请勿发布</div>');
  const buffer=await page.locator('div').screenshot();
  global.fetch=async()=>new Response(buffer,{headers:{'content-type':'image/png','content-length':String(buffer.length)}});
  await page.route('https://img.alicdn.com/test.png',route=>route.fulfill({contentType:'image/png',body:buffer}));
  await page.setContent(`<form onsubmit="window.submitted=true;return false"><div contenteditable="true" data-placeholder="描述"></div><input placeholder="0.00"><input placeholder="0.00"><input placeholder="0.00"><input type="radio" name="shipping" value="0"><input type="radio" name="shipping" value="1"><input type="radio" name="shipping" value="2"><input type="radio" name="shipping" value="3"><div id="images"></div><input name="file" type="file" multiple><span class="address--fixture">已选择地址</span><button type="submit">发布</button></form><script>document.querySelector('input[type=file]').onchange=e=>{document.querySelector('#images').innerHTML=[...e.target.files].map(()=>'<div class="preview-container--fixture"><img style="width:96px;height:96px" src="https://img.alicdn.com/test.png"></div>').join('');};</script>`);
  const result=await fillPublishForm(page,input());
  assert.equal(result.state,'prepared');
  assert.equal((await page.locator('[contenteditable]').innerText()).replace(/\n{3,}/g,'\n\n'),publishInput(input()).text);
  assert.equal(await page.getByPlaceholder('0.00',{exact:true}).nth(0).inputValue(),'12.50');
  assert.equal(await page.getByPlaceholder('0.00',{exact:true}).nth(2).inputValue(),'8.00');
  assert.equal(await page.locator('input[value="2"]').isChecked(),true);
  assert.equal(await page.evaluate(()=>Boolean(window.submitted)),false);
  global.fetch=async()=>new Response('image unavailable',{status:404});
  await assert.rejects(()=>fillPublishForm(page,{...input(),version:2}),/商品图片暂时无法读取/);
  assert.equal(await page.evaluate(()=>Boolean(window.submitted)),false);
 }finally{global.fetch=originalFetch;await browser.close();}
});
