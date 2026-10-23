'use strict';
const {chromium}=require('../../workers/crawlers/node_modules/playwright-core');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const base=process.env.APPLE_TRANSACTION_URL||process.env.APPLE_UI_URL||'http://127.0.0.1:3105';
const dir=process.env.APPLE_TRANSACTION_OUTPUT?path.resolve(process.env.APPLE_TRANSACTION_OUTPUT):path.join(__dirname,'transactions');
const accounts=[{id:'11111111-1111-4111-8111-111111111111',key:'manager_one',displayName:'管理员甲',avatarInitial:'甲',position:1,active:true,online:true},{id:'22222222-2222-4222-8222-222222222222',key:'manager_two',displayName:'管理员乙',avatarInitial:'乙',position:2,active:true,online:true}];
const timestamp='2026-10-09T00:00:00.000Z';
const original={id:'33333333-3333-4333-8333-333333333333',sourceUrl:'https://jp.mercari.com/item/m11111111111',titleRaw:'匿名商品界面夹具',priceCurrent:9500,priceTotalEst:9500,shippingFee:0,listedAt:timestamp,detectedAt:timestamp,lastSeenAt:timestamp,updatedAt:timestamp,listingType:'direct',categoryIp:'other',categoryToyType:'other',manufacturer:'界面夹具',conditionGrade:'new',channel:'marketplace',quantityEst:null,unitCostEst:null,confidence:1,needsReview:false,status:'active',favorite:false,ignored:false,source:{key:'mercari',displayName:'Mercari'},seller:{name:'匿名卖家',sellerType:'individual'},images:[]};
async function frames(page){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}
async function navigation(page,label){await page.getByRole('navigation',{name:'主要工作区'}).getByRole('button',{name:label,exact:true}).click();}
async function controlsOverflow(panel){return panel.evaluate(node=>Array.from(node.querySelectorAll('input,textarea,button,[role="alert"]')).flatMap(control=>{const rect=control.getBoundingClientRect(),style=getComputedStyle(control);return rect.width&&rect.height&&style.visibility!=='hidden'&&(rect.left<0||rect.right>innerWidth+1)?[{tag:control.tagName,type:control.getAttribute('type'),left:rect.left,right:rect.right,viewport:innerWidth}]:[]}));}
async function fixtureReady(page,predicate,label){const deadline=Date.now()+60000;while(!predicate()&&Date.now()<deadline)await page.waitForTimeout(20);assert.ok(predicate(),label);}
async function identityTransform(locator){return locator.evaluate(node=>{const value=getComputedStyle(node).transform;return value==='none'||new DOMMatrixReadOnly(value).isIdentity;});}
(async()=>{
 fs.mkdirSync(dir,{recursive:true});
 const browser=await chromium.launch({headless:true,channel:'chrome'});const report=[];let activePage,activeDiagnostics;
 try{
  for(const setting of [{width:1440,height:1000,reducedMotion:'no-preference'},{width:390,height:844,reducedMotion:'no-preference'},{width:320,height:568,reducedMotion:'reduce'}]){
   const item={...original,titleZh:'Apple交互验收商品',descriptionZh:Array.from({length:14},(_,i)=>`第${i+1}行：保留商品事实、中文说明与人工维护信息。`).join('\n'),favorite:false,note:null,translationStatus:'completed',images:[0,1,2].map(position=>({url:`${base}/transaction-photo-${position}.svg`,position}))};
   const secondItem={...item,id:'44444444-4444-4444-8444-444444444444',titleRaw:'匿名第二商品界面夹具',titleZh:'Apple打包验收商品二',sourceUrl:'https://jp.mercari.com/item/m22222222222',priceCurrent:6500,priceTotalEst:6500};
   const context=await browser.newContext({viewport:{width:setting.width,height:setting.height},reducedMotion:setting.reducedMotion});
   await context.addInitScript(id=>localStorage.setItem('kamen-procurement-manager-v1',id),accounts[0].id);
   const page=await context.newPage();activePage=page;page.setDefaultTimeout(60000);const errors=[],hydration=[];let cartItems=[],failedPatch=false,failPurchase=true,patches=0,purchases=0,realCalls=0,holdPatch=false,releasePatch;
   let bundles=[],bundleSaves=0,bundleReads=0,failBundle=true,releaseBundle,releaseAnalysis,analysisSubmits=0,analysisPolls=0;const bundlePayloads=[],unmatchedGetFixtures=new Set(),blockedMutationAttempts=[];
   const backendRequests=[];activeDiagnostics={errors,hydration,backendRequests};
   page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/hydrat|didn't match/i.test(m.text()))hydration.push(m.text());});
   await page.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url()),endpoint=url.pathname.replace(/^\/backend/,'');
    const json=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
    if(/\/transaction-photo-\d.svg$/.test(endpoint)){const n=Number(endpoint.match(/(\d).svg/)[1]);return route.fulfill({contentType:'image/svg+xml',body:`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="${['#e0efff','#dbf2e9','#fae9d7'][n]}"/><circle cx="400" cy="260" r="130" fill="white"/><text x="400" y="290" text-anchor="middle" font-size="90" fill="#0071e3">${n+1}</text></svg>`});}
    if(!url.pathname.startsWith('/backend/')&&url.port!=='3001')return route.continue();
    backendRequests.push({endpoint,method:req.method()});
    if(endpoint==='/collaboration/accounts')return json({accounts});
    if(endpoint==='/collaboration/messages')return json({messages:[],nextAfter:null});
    if(endpoint==='/collaboration/negotiations')return json({cases:[]});
    if(endpoint==='/exchange-rate')return json({pair:'JPY_CNY',rate:.05,updatedAt:timestamp});
    if(endpoint==='/ai/resources')return json({configured:true,available:true,model:'glm-5.3-flash',tokenLimit:10000,dailyTokenLimit:1000,accountedTokens:0,todayTokens:0,remainingLocalBudget:10000,allowedUses:['product_reading','translation','chat'],note:'匿名界面夹具'});
    if(endpoint==='/monitoring/config')return json({keywords:[],categories:[],platforms:[]});
    if(endpoint==='/monitoring/overview')return json({serverTime:timestamp,activeTotal:1,productTotal:1,pendingReviewTotal:0,inventoryTotal:0,discovered24h:0,totals24h:{candidates:0,inserted:0,skippedKnown:0,detailFailed:0,succeeded:0,failed:0},sources:[],recent:[]});
    if(endpoint==='/items/purchases/analyze-links'){analysisSubmits++;assert.equal(req.method(),'POST');const urls=req.postDataJSON().urls;assert.deepEqual(urls,[item.sourceUrl,secondItem.sourceUrl]);await new Promise(resolve=>releaseAnalysis=resolve);return json({results:urls.map((sourceUrl,index)=>({url:sourceUrl,accepted:true,jobId:`fixture-link-${index}`})),acceptedCount:2,rejectedCount:0});}
    if(/^\/items\/purchases\/analyze-links\/fixture-link-[01]$/.test(endpoint)){analysisPolls++;assert.equal(req.method(),'GET');return json({state:'completed',progress:100,item:endpoint.endsWith('-0')?item:secondItem,failedReason:null});}
    if(endpoint==='/items/purchases/bundles'){
     if(req.method()==='GET'){bundleReads++;return json({bundles,total:bundles.length,page:1,pageCount:1,grandTotalPurchaseAmountYen:bundles.reduce((sum,bundle)=>sum+bundle.totalPurchaseAmount,0)});}
     assert.equal(req.method(),'POST');bundleSaves++;const payload=req.postDataJSON();bundlePayloads.push(payload);await new Promise(resolve=>releaseBundle=resolve);if(failBundle)return json({message:'验收打包保存失败'},503);
     const bundle={id:'55555555-5555-4555-8555-555555555555',pricingMode:payload.pricingMode,totalPurchaseAmount:payload.totalPurchaseAmountYen,currency:'JPY',purchasedAt:payload.purchasedAt,note:payload.note,version:1,purchases:payload.members.map((member,index)=>({id:`fixture-bundle-record-${index}`,itemId:member.itemId,bundleId:'55555555-5555-4555-8555-555555555555',purchaseAmount:member.amountYen??0,amountAllocated:payload.pricingMode==='per_item',purchasedAt:payload.purchasedAt,note:null,receipts:[],item:{...(member.itemId===item.id?item:secondItem),purchaseRecord:null}}))};bundles=[bundle];return json({bundle});
    }
    if(endpoint==='/items')return json({items:[item],total:1});
    if(endpoint==='/items/changes')return json({changes:[],cursor:new Date().toISOString()});
    if(endpoint===`/items/${item.id}`){if(req.method()==='PATCH'){patches++;if(holdPatch)await new Promise(resolve=>releasePatch=resolve);if(failedPatch)return json({message:'验收保存失败'},503);Object.assign(item,req.postDataJSON());}return json({item});}
    if(endpoint===`/items/${item.id}/purchase`){purchases++;if(failPurchase){failPurchase=false;return json({message:'验收购买保存失败'},503);}item.purchaseRecord={id:'purchase-fixture',itemId:item.id,purchaseAmount:req.postDataJSON().purchaseAmount,purchasedAt:timestamp,note:req.postDataJSON().note,receipts:[]};return json({purchase:item.purchaseRecord});}
    if(endpoint==='/cart')return json({items:cartItems,count:cartItems.length});
    if(endpoint===`/cart/items/${item.id}`){cartItems=req.postDataJSON().present?[item]:[];return json({items:cartItems,count:cartItems.length});}
    if(endpoint==='/items/purchases')return json({purchases:[...(item.purchaseRecord?[{...item.purchaseRecord,item}]:[]),...bundles.flatMap(bundle=>bundle.purchases)]});
    if(/^\/(analysis|ai)(\/|$)/.test(endpoint)){realCalls++;return json({message:'验收阻止模型与分析调用'},403);}
    if(!['GET','HEAD','OPTIONS'].includes(req.method())){blockedMutationAttempts.push({endpoint,method:req.method()});return json({ok:true});}
    unmatchedGetFixtures.add(endpoint);return json({items:[],total:0,categories:[],sources:[],keywords:[],platforms:[],accounts:[],messages:[],cases:[],changes:[],orders:[],carriers:[],purchases:[],bundles:[],summary:{},data:[]});
   });
   await page.goto(`${base}/?workspace=catalog`,{waitUntil:'domcontentloaded'});
   const card=page.locator(`.js-product-card[data-item-id="${item.id}"]`);assert.deepEqual(errors,[]);await Promise.race([card.waitFor(),page.waitForEvent('pageerror').then(error=>{throw error;})]);
   const favorite=card.getByRole('button',{name:/^(收藏商品|取消收藏)$/});
   holdPatch=true;await favorite.click();await card.getByText('正在保存…',{exact:true}).waitFor();
   assert.equal(await favorite.isDisabled(),true);assert.equal(patches,1);holdPatch=false;releasePatch();
   await card.getByText('已收藏',{exact:true}).waitFor();assert.equal(await card.getByRole('button',{name:'取消收藏',exact:true}).getAttribute('aria-pressed'),'true');
   failedPatch=true;await card.getByRole('button',{name:'取消收藏',exact:true}).click();
   await card.getByText('保存失败，已恢复原状态',{exact:true}).waitFor();assert.equal(await card.getByRole('button',{name:'取消收藏',exact:true}).getAttribute('aria-pressed'),'true');failedPatch=false;
   await card.getByRole('button',{name:'加入购物车',exact:true}).click();await card.getByText('已加入采购清单',{exact:true}).waitFor();assert.equal(cartItems.length,1);
   await card.getByRole('button',{name:'移出购物车',exact:true}).click();await card.getByText('已移出采购清单',{exact:true}).waitFor();assert.equal(cartItems.length,0);
   await card.getByRole('button',{name:'添加采购备注',exact:true}).click();
   const note=page.getByRole('dialog',{name:'采购备注',exact:true});await note.waitFor();await note.getByRole('textbox').fill('人工备注保持输入');
   failedPatch=true;await note.getByRole('button',{name:'保存',exact:true}).click();await note.getByRole('alert').waitFor();assert.equal(await note.getByRole('textbox').inputValue(),'人工备注保持输入');failedPatch=false;
   await note.getByRole('button',{name:'保存',exact:true}).click();await note.waitFor({state:'detached'});assert.equal(item.note,'人工备注保持输入');
   const surface=card.getByRole('button',{name:'打开商品：Apple交互验收商品',exact:true});await surface.click();
   const actualDetail=page.locator('.product-detail-panel');await actualDetail.waitFor();
   const gallery=actualDetail.locator('[aria-roledescription="图片轮播"]');await gallery.locator('img[alt="Apple交互验收商品"]').waitFor();
   await gallery.getByRole('button',{name:'查看下一张商品图片',exact:true}).click();await page.waitForTimeout(70);
   assert.equal(await gallery.getByRole('button',{name:'选择第 2 张商品图片',exact:true}).getAttribute('aria-pressed'),'true');
   await gallery.getByRole('button',{name:'查看上一张商品图片',exact:true}).click();
   await gallery.getByRole('button',{name:'选择第 3 张商品图片',exact:true}).click();
   const thumbnail=gallery.getByRole('button',{name:'选择第 3 张商品图片',exact:true});await thumbnail.focus();await page.keyboard.press('ArrowLeft');
   assert.equal(await gallery.getByRole('button',{name:'选择第 2 张商品图片',exact:true}).getAttribute('aria-pressed'),'true');
   assert.equal(await actualDetail.count(),1,'gallery controls do not reopen the parent detail');
   await page.waitForTimeout(300);
   await actualDetail.locator('.product-detail-scroll').evaluate(node=>node.scrollTop=0);
   await page.screenshot({path:path.join(dir,`gallery-${setting.width}-${setting.reducedMotion}.png`)});
   const readButton=actualDetail.getByRole('button',{name:'阅读全文',exact:true});await readButton.click();await actualDetail.getByRole('button',{name:'收起',exact:true}).click();await readButton.click();
   const disclosure=actualDetail.locator('details').first();const summary=disclosure.locator('summary');await summary.click();await summary.click();await summary.focus();await page.keyboard.press('Enter');assert.equal(await disclosure.evaluate(node=>node.open),true);
   await page.waitForTimeout(350);assert.equal(await actualDetail.evaluate(node=>getComputedStyle(node).transform),'none');
   await page.screenshot({path:path.join(dir,`detail-${setting.width}-${setting.reducedMotion}.png`)});
   await actualDetail.getByRole('button',{name:'返回上一步',exact:true}).click();await actualDetail.waitFor({state:'detached'});
   const more=card.getByRole('button',{name:'更多商品操作',exact:true});await more.click();const menu=card.locator('.product-card-more-actions');await menu.waitFor();await page.keyboard.press('Escape');await menu.waitFor({state:'detached'});assert.equal(await more.evaluate(node=>document.activeElement===node),true);
   await more.focus();await page.keyboard.press('Enter');await card.getByRole('button',{name:'记录购买',exact:true}).click();
   const purchase=page.getByRole('dialog',{name:'记录已购买商品',exact:true});await purchase.waitFor();
   const amount=purchase.getByRole('spinbutton');await amount.fill('2468');await purchase.getByRole('button',{name:'确认购买',exact:true}).click();await purchase.getByRole('alert').waitFor();assert.equal(await amount.inputValue(),'2468');
   const panelOverflow=await controlsOverflow(purchase);assert.deepEqual(panelOverflow,[],'visible purchase controls stay within the viewport');
   await page.screenshot({path:path.join(dir,`purchase-error-${setting.width}-${setting.reducedMotion}.png`)});
   await purchase.getByRole('button',{name:'确认购买',exact:true}).click();await purchase.waitFor({state:'detached'});assert.equal(item.purchaseRecord.purchaseAmount,2468);assert.equal(purchases,2);

   await navigation(page,'工作台');await page.locator('#workbench-title').waitFor();
   await page.getByRole('button',{name:/^购买记录 /}).click();
   const links=page.getByRole('textbox',{name:'购买商品链接',exact:true});await links.waitFor();assert.equal(new URL(page.url()).searchParams.get('workspace'),'purchases');
   await links.fill(`${item.sourceUrl}\n${secondItem.sourceUrl}`);await page.getByRole('button',{name:'分析链接',exact:true}).click();await page.getByRole('button',{name:'分析中…',exact:true}).waitFor();
   assert.equal(await page.getByRole('button',{name:'分析中…',exact:true}).isDisabled(),true);await fixtureReady(page,()=>releaseAnalysis,'analysis fixture started');assert.equal(analysisSubmits,1);
   await navigation(page,'工作台');await page.locator('#workbench-title').waitFor();releaseAnalysis();await fixtureReady(page,()=>analysisPolls>=2,'both analysis GET polls are fixture-completed');
   await page.getByRole('button',{name:/^购买记录 /}).click();await links.waitFor();
   const members=page.getByRole('checkbox',{name:'选择加入购买包',exact:true});await members.nth(1).waitFor();assert.equal(await members.count(),2,'analysis results persist across workspace navigation');assert.equal(await links.inputValue(),'');
   await members.nth(0).check();await members.nth(1).check();await page.getByRole('button',{name:'打包登记 · 2',exact:true}).click();
   const bundle=page.getByRole('dialog',{name:'登记打包购买 · 2 件',exact:true});await bundle.waitFor();
   const totalMode=bundle.getByRole('button',{name:'打包总价',exact:true}),itemMode=bundle.getByRole('button',{name:'分别计价',exact:true});
   assert.equal(await totalMode.getAttribute('aria-pressed'),'true');assert.equal(await totalMode.locator('[data-apple-motion-owned]').count(),1);assert.equal(await totalMode.locator('[data-apple-motion-owned]').getAttribute('tabindex'),'-1');
   await itemMode.click();await totalMode.click();await itemMode.click();assert.equal(await itemMode.getAttribute('aria-pressed'),'true');assert.equal(await bundle.locator('[data-apple-motion-owned]').count(),1,'one selected pricing indicator survives rapid reversal');
   const amounts=bundle.getByRole('spinbutton');assert.equal(await amounts.count(),2);await amounts.nth(0).fill('1111');await amounts.nth(1).fill('2222');
   await totalMode.click();await bundle.getByLabel('打包价格',{exact:true}).fill('5555');
   await itemMode.focus();await page.keyboard.press('Enter');await frames(page);assert.equal(await itemMode.getAttribute('aria-pressed'),'true');assert.equal(await identityTransform(itemMode.locator('[data-apple-motion-owned]')),true,'keyboard selection indicator reaches its target immediately');
   assert.deepEqual(await bundle.getByRole('spinbutton').evaluateAll(nodes=>nodes.map(node=>node.value)),['1111','2222'],'per-item amounts remain after pricing changes');
   await page.keyboard.down('Space');await frames(page);activeDiagnostics.keyboardPricingPress=await itemMode.evaluate(node=>({transform:getComputedStyle(node).transform,input:document.documentElement.dataset.appleInput,ambientOwner:node.dataset.appleMotionOwned??null}));assert.equal(await identityTransform(itemMode),true,'keyboard press adds no ambient button displacement');await page.keyboard.up('Space');
   await totalMode.focus();await page.keyboard.press('Enter');await frames(page);assert.equal(await identityTransform(totalMode.locator('[data-apple-motion-owned]')),true);assert.equal(await bundle.getByLabel('打包价格',{exact:true}).inputValue(),'5555');
   await bundle.getByLabel('购买日期',{exact:true}).fill('2026-10-09');await bundle.getByLabel('备注',{exact:true}).fill('打包备注保留');
   const submit=bundle.getByRole('button',{name:'确认登记',exact:true});await submit.evaluate(node=>{node.click();node.click();});await bundle.getByRole('button',{name:'保存中…',exact:true}).waitFor();await fixtureReady(page,()=>releaseBundle,'bundle save fixture started');
   assert.equal(bundleSaves,1,'same-frame submit dedupes before React pending state');assert.equal(await bundle.getAttribute('aria-busy'),'true');assert.equal(await bundle.getByRole('button',{name:'保存中…',exact:true}).isDisabled(),true);assert.equal(await bundle.getByRole('button',{name:'关闭购买包编辑',exact:true}).isDisabled(),true);
   await bundle.getByRole('button',{name:'保存中…',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:path.join(dir,`bundle-pending-${setting.width}-${setting.reducedMotion}.png`)});const firstRelease=releaseBundle;releaseBundle=null;firstRelease();
   await bundle.getByRole('alert').getByText('验收打包保存失败',{exact:true}).waitFor();assert.equal(await bundle.getAttribute('data-submit-state'),'error');assert.equal(await bundle.getByLabel('打包价格',{exact:true}).inputValue(),'5555');assert.equal(await bundle.getByLabel('购买日期',{exact:true}).inputValue(),'2026-10-09');assert.equal(await bundle.getByLabel('备注',{exact:true}).inputValue(),'打包备注保留');assert.equal(await bundle.getByRole('checkbox',{checked:true}).count(),2);
   const bundleOverflow=await controlsOverflow(bundle);assert.deepEqual(bundleOverflow,[],'visible bundle controls stay within the viewport');await submit.scrollIntoViewIfNeeded();const bundleSubmitBounds=await submit.boundingBox();assert.ok(bundleSubmitBounds.y>=0&&bundleSubmitBounds.y+bundleSubmitBounds.height<=setting.height+1,'bundle primary action is reachable inside a narrow viewport');await page.screenshot({path:path.join(dir,`bundle-error-${setting.width}-${setting.reducedMotion}.png`)});
   failBundle=false;await submit.evaluate(node=>{node.click();node.click();});await fixtureReady(page,()=>releaseBundle,'retry bundle fixture started');assert.equal(bundleSaves,2,'retry submit also dedupes');releaseBundle();await bundle.waitFor({state:'detached'});
   const saved=page.locator('.purchase-history-card').filter({hasText:'打包备注保留'});await saved.waitFor();await saved.getByRole('heading',{name:'打包购买 · 2 件',exact:true}).waitFor();assert.equal(await members.count(),0,'saved members leave the analysis queue');assert.equal(bundles[0].totalPurchaseAmount,5555);assert.equal(bundles[0].purchases.length,2);assert.deepEqual(bundlePayloads.map(payload=>payload.members.map(member=>member.itemId)),[[item.id,secondItem.id],[item.id,secondItem.id]]);
   await page.screenshot({path:path.join(dir,`bundle-success-${setting.width}-${setting.reducedMotion}.png`)});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);assert.deepEqual(errors,[]);assert.deepEqual(hydration,[]);
   assert.equal(realCalls,0,'no unexpected model or analysis call');
   report.push({target:base,...setting,flows:['favorite-pending-success-rollback','cart-add-remove-confirmation','note-error-input-retention-save','gallery-reverse-thumbnail-keyboard-event-isolation','description-and-disclosure-fast-reversal','more-menu-escape-focus-keyboard','purchase-error-retry-completion','link-analysis-pending-navigation-preservation','bundle-pricing-reversal-keyboard-material-input-retention','bundle-save-pending-error-retry-success-same-frame-deduplication'],patches,purchases,analysisSubmits,analysisPolls,bundleSaves,bundleReads,purchaseControlsOverflow:panelOverflow,bundleControlsOverflow:bundleOverflow,pageErrors:errors,hydrationErrors:hydration,realBusinessRequests:0,realWrites:0,realModelCalls:0,blockedModelAttempts:realCalls,blockedMutationAttempts,unmatchedGetFixtures:[...unmatchedGetFixtures]});console.log(JSON.stringify(report.at(-1)));await context.close();
  }
  fs.writeFileSync(path.join(dir,'report.json'),JSON.stringify(report,null,2));for(const name of ['failure.json','failure.png']){const artifact=path.join(dir,name);if(fs.existsSync(artifact))fs.unlinkSync(artifact);}
 }catch(error){fs.writeFileSync(path.join(dir,'failure.json'),JSON.stringify({target:base,completed:report,diagnostics:activeDiagnostics,error:error.stack},null,2));if(activePage&&!activePage.isClosed())await activePage.screenshot({path:path.join(dir,'failure.png')});throw error;}finally{await browser.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
