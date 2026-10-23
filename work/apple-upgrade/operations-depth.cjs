const { chromium } = require('../../workers/crawlers/node_modules/playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { recordContrast, writeContrastSummary } = require('./contrast-evidence.cjs');
const target = process.env.EDITORIAL_UI_URL || 'http://localhost:3105';
const out = process.env.EDITORIAL_UI_OUT || 'work/apple-upgrade/operations-depth';
fs.mkdirSync(out, { recursive: true });
const accounts = [{ id:'11111111-1111-4111-8111-111111111111', key:'manager_one', displayName:'龙', avatarInitial:'龙', position:1, active:true, online:true }, { id:'22222222-2222-4222-8222-222222222222', key:'manager_two', displayName:'润', avatarInitial:'润', position:2, active:true, online:true }];
const item = { id:'depth-product', titleRaw:'核对配件与数量的商品', titleZh:'核对配件与数量的商品', priceCurrent:10000, listingType:'direct', source:{ key:'mercari', displayName:'Mercari' }, sourceUrl:'https://example.org/ui-fixture', images:[], favorite:true, logistics:{weightGrams:100,packageWeightGrams:120,lengthMm:120,widthMm:80,heightMm:60,estimatedSalePriceYen:18000} };
const order = { id:'depth-order', orderNumber:'TEST-001', name:'界面验收库存', platform:'Mercari', purchaseCost:10000, initialQuantity:10, remainingQuantity:8, soldQuantity:2, totalSales:3000, status:'partially_sold', statusLabel:'部分售出', averageCost:1000, realizedProfit:1000, recoveryPercent:30, purchasedAt:'2026-10-09T00:00:00Z' };
const baseMessage = {senderId:accounts[1].id,recipientId:accounts[0].id,sender:accounts[1],recipient:accounts[0],readAt:'2026-10-09T00:00:00Z',updatedAt:'2026-10-09T00:00:00Z',reactions:[]};
const messages = Array.from({length:24},(_,i)=>({...baseMessage,id:`depth-message-${i}`,text:`第 ${i+1} 条采购讨论，核对原始商品内容。`,createdAt:new Date(Date.UTC(2026,9,9,0,i)).toISOString()}));
messages[23].replyTo = {id:messages[2].id,text:messages[2].text,sender:accounts[1]};
const history = Array.from({length:16},(_,i)=>({id:`depth-answer-${i}`,role:i%2?'assistant':'user',content:'界面验收的采购讨论，用于保持原来的阅读位置。'.repeat(4),...(i===15?{items:[item],suggestions:[],generatedAt:'2026-10-09T00:00:00Z'}:{})}));
const resource = {configured:true,available:true,model:'glm-5.3-flash',tokenLimit:14000000,dailyTokenLimit:200000,accountedTokens:5090,todayTokens:5090,remainingLocalBudget:13994910,expiresAt:'2026-11-09T00:00:00Z',allowedUses:['product_reading','translation','chat'],note:'界面验收夹具，不调用实际模型。'};
const intel = {id:'depth-intel',sourceUrl:'https://example.org/ui-fixture',sourceName:'公开收藏资讯',sourcePlatform:'forum',kind:'forum',titleRaw:'原始资讯标题',titleZh:'配件与商品资讯',bodyRaw:'原始公开资讯正文',bodyZh:'翻译后的公开资讯正文',translationStatus:'completed',detectedAt:'2026-10-09T00:00:00Z'};
const report = {target,checks:[],errors:[],intercepted:[],forwardedMutations:0,contrast:[]};
async function check(page, name, settings, task) { await task(); const overflow = await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1); assert.equal(overflow,false,`${name} document overflow`); report.checks.push({name,settings}); }
async function frames(page) { await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))); }
(async()=>{
 const browser = await chromium.launch({headless:true,channel:'chrome'});
 let activePage;
 try {
  for (const settings of [{width:1440,height:1000,motion:'no-preference'},{width:390,height:844,motion:'no-preference'},{width:390,height:568,motion:'reduce'}]) {
   const context = await browser.newContext({viewport:{width:settings.width,height:settings.height},reducedMotion:settings.motion});
   await context.addInitScript(({actor,history})=>{localStorage.setItem('kamen-procurement-manager-v1',actor);localStorage.setItem('kamen-procurement-assistant-v1',JSON.stringify(history));},{actor:accounts[0].id,history});
   const page = await context.newPage(); activePage=page; page.setDefaultTimeout(60000);
   page.on('pageerror',error=>report.errors.push(error.message));
   let createFailure=true, logisticsFailure=false, holdOptimize=false, releaseOptimize, optimizeCalls=0, holdChat=true, releaseChat, releaseResult, resultCalls=0;
   await page.route('**/*', async route=>{
    const request=route.request(),url=new URL(request.url()),suffix=url.pathname.replace(/^\/backend/,'');
    const json=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
    if(url.pathname==='/operations-browser/')return route.fulfill({contentType:'text/html',body:'<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><body><p>运营窗口验收夹具</p><script>window.commands=[];addEventListener("message",e=>commands.push(e.data));</script></body></html>'});
    if(!url.pathname.startsWith('/backend/')&&url.port!=='3001')return route.continue();
    if(suffix==='/collaboration/accounts')return json({accounts});
    if(suffix==='/collaboration/messages'&&request.method()==='GET')return json({messages,nextAfter:messages.at(-1).updatedAt});
    if(suffix==='/collaboration/negotiations')return json({cases:[]});
    if(suffix==='/ai/resources')return json(resource);
    if(suffix==='/inventory-orders'&&request.method()==='GET')return json({orders:[order],total:1,totals:{purchaseCostYen:10000,totalSalesYen:3000}});
    if(suffix==='/inventory-orders'&&request.method()==='POST'){report.intercepted.push({suffix,method:request.method()});return createFailure?json({message:'保存失败夹具'},409):json({order},201);}
    if(suffix==='/logistics/items'&&request.method()==='GET')return json({items:[item]});
    if(suffix==='/logistics/carriers')return json({carriers:[{id:'depth-carrier',displayName:'验收快递',enabled:true}]});
    if(suffix==='/logistics/items/depth-product'&&request.method()==='PATCH'){report.intercepted.push({suffix,method:request.method()});return logisticsFailure?json({message:'物流参数保存失败'},409):json({logistics:request.postDataJSON()});}
    if(suffix==='/logistics/optimize'){optimizeCalls++;report.intercepted.push({suffix,method:request.method()});if(holdOptimize)await new Promise(resolve=>releaseOptimize=resolve);return json({best:{shippingYen:1000,itemCostYen:10000,saleYen:18000,profitYen:7000},ai:null});}
    if(suffix==='/market-intel')return json({items:url.searchParams.has('search')?[]:[intel],total:url.searchParams.has('search')?0:1,pageCount:1,lastUpdatedAt:'2026-10-09T00:00:00Z'});
    if(suffix==='/items/depth-product'){resultCalls++;await new Promise(resolve=>releaseResult=resolve);return json({message:'商品详情读取失败夹具'},404);}
    if(suffix==='/ai/chat'){report.intercepted.push({suffix,method:request.method()});if(holdChat)await new Promise(resolve=>releaseChat=resolve);return json({answerZh:'新回答界面验收结果',items:[],suggestions:[],model:'glm-5.3-flash',generatedAt:'2026-10-09T00:30:00Z'});}
    if(/^\/(ai|analysis)(\/|$)/.test(suffix)||request.method()!=='GET'){report.intercepted.push({suffix,method:request.method()});return json({message:'拦截真实模型与写入'},403);}
    return route.continue();
   });
   await page.goto(target+'/?workspace=orders',{waitUntil:'domcontentloaded'});
   const inventory=page.locator('.inventory-orders-workspace'); await inventory.getByText('界面验收库存',{exact:true}).waitFor();
   await check(page,'inventory failure retains draft then success returns receipt',settings,async()=>{
    await inventory.getByRole('button',{name:'新建订单',exact:true}).click(); const dialog=page.getByRole('dialog');
    await dialog.getByLabel('商品名称',{exact:true}).fill('新采购商品');await dialog.getByLabel('总成本（日元）',{exact:true}).fill('9000');
    await dialog.getByRole('button',{name:'创建订单',exact:true}).click();await dialog.getByRole('alert').getByText('保存失败夹具').waitFor();assert.equal(await dialog.getByLabel('商品名称',{exact:true}).inputValue(),'新采购商品');
    createFailure=false;await dialog.getByRole('button',{name:'创建订单',exact:true}).click();await inventory.getByRole('status').getByText('已新建订单 · 新采购商品').waitFor();assert.equal(await page.getByRole('dialog').count(),0);
   });
   report.contrast.push(...await recordContrast(page,out,`orders-${settings.width}-${settings.motion}`,settings,[{name:'Header brand',selector:'.procurement-header .brand-name'},{name:'Header exchange rate',selector:'.procurement-header .exchange-rate-inline'},{name:'Nav home',selector:'.primary-navigation [aria-label="首页"] .primary-navigation-label'},{name:'Nav AI',selector:'.primary-navigation [aria-label="AI"] .primary-navigation-label'},{name:'Nav messages',selector:'.primary-navigation [aria-label="消息"] .primary-navigation-label'},{name:'Nav active workbench',selector:'.primary-navigation [aria-label="工作台"] .primary-navigation-label'},{name:'Inventory success receipt',selector:'[class*="actionReceipt"]'}]));
   await page.goto(target+'/?workspace=logistics',{waitUntil:'domcontentloaded'});
   const shipping=page.locator('.logistics-workspace'); await shipping.getByRole('button',{name:/核对配件与数量的商品/}).click();
   await shipping.getByRole('button',{name:'商品参数 · 1 件',exact:true}).click();const weight=shipping.getByLabel('商品重量',{exact:true});await weight.fill('200');await shipping.getByLabel('实际快递费',{exact:true}).fill('1000');
   await check(page,'logistics calculation has local saved receipt',settings,async()=>{await shipping.getByRole('button',{name:'计算利润',exact:true}).click();await shipping.getByRole('status').getByText('已保存',{exact:true}).waitFor();await shipping.getByText('本次结果',{exact:true}).waitFor();});
   await check(page,'logistics failure preserves edited parameter',settings,async()=>{logisticsFailure=true;await weight.fill('300');await shipping.getByRole('button',{name:'计算利润',exact:true}).click();await shipping.getByRole('status').getByText('保存失败，修改仍保留').waitFor();assert.equal(await weight.inputValue(),'300');assert.equal(await shipping.getByText('本次结果',{exact:true}).count(),0);logisticsFailure=false;});
   await check(page,'logistics rapid repeat is deduped and stale result rejected',settings,async()=>{holdOptimize=true;const initial=optimizeCalls;await shipping.getByRole('button',{name:'计算利润',exact:true}).evaluate(el=>{el.click();el.click();});await page.waitForFunction(()=>document.querySelector('.logistics-workspace').textContent.includes('计算中'));while(!releaseOptimize)await page.waitForTimeout(20);await weight.fill('400');releaseOptimize();await shipping.getByText('参数已修改，请重新计算',{exact:true}).waitFor();assert.equal(optimizeCalls,initial+1);assert.equal(await weight.inputValue(),'400');assert.equal(await shipping.getByText('本次结果',{exact:true}).count(),0);holdOptimize=false;});
   await page.goto(target+'/?workspace=intel',{waitUntil:'domcontentloaded'});
   const news=page.locator('section[aria-labelledby="market-intel-heading"]');
   await news.getByText('配件与商品资讯',{exact:true}).filter({visible:true}).first().waitFor();
   await check(page,'intel empty query recovers and returns input focus',settings,async()=>{await news.locator('#intel-search').fill('没有匹配的资讯');await news.getByRole('button',{name:'清除筛选',exact:true}).click();await news.getByText('配件与商品资讯',{exact:true}).filter({visible:true}).first().waitFor();assert.equal(await news.locator('#intel-search').inputValue(),'');assert.equal(await page.evaluate(()=>document.activeElement?.id),'intel-search');});
   await page.goto(target+'/?workspace=collaboration',{waitUntil:'domcontentloaded'});
   const chat=page.locator('.collaboration-chat'); await chat.getByText(messages[23].text,{exact:true}).waitFor();
   await check(page,'text reply reference locates original with keyboard instant position',settings,async()=>{const quote=chat.getByRole('button',{name:'定位 润 的原消息',exact:true});await quote.focus();await page.keyboard.press('Enter');await frames(page);assert.equal(await page.evaluate(()=>document.activeElement?.id),'collaboration-message-depth-message-2');assert.equal(await chat.locator('[data-quoted="true"]').count(),1);const y=await chat.locator('#collaboration-message-depth-message-2').evaluate(el=>el.getBoundingClientRect().top-el.closest('.collaboration-feed').getBoundingClientRect().top);assert.ok(y>=0&&y<80);});
   await check(page,'reply action puts focus in composer and removal preserves text',settings,async()=>{await chat.locator('#collaboration-message-depth-message-2').press('Enter');await chat.getByRole('button',{name:'回复消息',exact:true}).click();assert.equal(await chat.getByRole('textbox',{name:'消息内容',exact:true}).evaluate(el=>el===document.activeElement),true);await chat.getByRole('textbox',{name:'消息内容',exact:true}).fill('继续核对采购');await chat.getByRole('button',{name:'移除引用',exact:true}).click();assert.equal(await chat.getByRole('textbox',{name:'消息内容',exact:true}).inputValue(),'继续核对采购');});
   await page.goto(target+'/?workspace=assistant',{waitUntil:'domcontentloaded'});
   const assistant=page.locator('.assistant-chat'); await assistant.getByRole('button',{name:/核对配件与数量的商品/}).waitFor();
   await check(page,'assistant result pending dedupes clicks and failure remains recoverable',settings,async()=>{await assistant.getByRole('button',{name:/核对配件与数量的商品/}).evaluate(el=>{el.click();el.click();});await assistant.getByRole('status').getByText('正在打开商品…').waitFor();assert.equal(await assistant.getByRole('button',{name:/核对配件与数量的商品/}).getAttribute('aria-busy'),'true');while(!releaseResult)await page.waitForTimeout(20);releaseResult();await assistant.getByRole('alert').getByText('商品暂时无法打开，可稍后重试。').waitFor();assert.equal(await assistant.getByRole('button',{name:/核对配件与数量的商品/}).isEnabled(),true);assert.equal(resultCalls,1);});
   await check(page,'assistant incoming answer preserves old reading and new answer action',settings,async()=>{await assistant.locator('#assistant-input').fill('核对商品');await assistant.getByRole('button',{name:'发送',exact:true}).click();while(!releaseChat)await page.waitForTimeout(20);const feed=assistant.locator('.assistant-chat-feed');await feed.evaluate(el=>{el.scrollTop=100;el.dispatchEvent(new Event('scroll',{bubbles:true}));});releaseChat();await assistant.getByRole('button',{name:'查看新回答',exact:true}).waitFor();assert.ok(Math.abs(await feed.evaluate(el=>el.scrollTop)-100)<2);await page.screenshot({path:`${out}/assistant-${settings.width}-${settings.motion}.png`});await assistant.getByRole('button',{name:'查看新回答',exact:true}).click();await assistant.getByRole('button',{name:'查看新回答',exact:true}).waitFor({state:'detached'});assert.ok(await feed.evaluate(el=>el.scrollHeight-el.scrollTop-el.clientHeight<5));});
   await page.goto(target+'/?workspace=ai',{waitUntil:'domcontentloaded'});
   const ai=page.locator('[aria-labelledby="ai-system-title"]');await ai.getByText('glm-5.3-flash',{exact:true}).waitFor();
   await check(page,'AI purpose focus material is immediate and does not call model',settings,async()=>{const button=ai.getByRole('button',{name:'到商品库，从详情读取商品',exact:true});await button.focus();await page.keyboard.press('Tab');await button.focus();const css=await button.evaluate(el=>({background:getComputedStyle(el.closest('article')).backgroundColor,transition:getComputedStyle(el.closest('article')).transitionDuration,mode:document.documentElement.dataset.appleInput}));assert.equal(css.background,'rgb(241, 247, 255)');assert.ok(parseFloat(css.transition)<=0.00002);assert.equal(css.mode,'keyboard');await ai.locator('summary').click();await ai.getByText('只使用 GLM-5.3-Flash，没有付费模型回退。',{exact:true}).waitFor();});
   const aiEntry=ai.getByRole('button',{name:'到商品库，从详情读取商品',exact:true});await aiEntry.scrollIntoViewIfNeeded();await aiEntry.focus();
   report.contrast.push(...await recordContrast(page,out,`ai-entry-${settings.width}-${settings.motion}`,settings,[{name:'AI product entry on focused pale blue',selector:'[aria-label="到商品库，从详情读取商品"]'},{name:'AI purpose heading',selector:'[data-ai-purpose="product_reading"] h4'}]));
   await page.goto(target+'/?workspace=operations',{waitUntil:'domcontentloaded'});
   const ops=page.locator('.operations-workspace');await page.frameLocator('iframe[data-operations-frame]').getByText('运营窗口验收夹具').waitFor();
   await check(page,'operations reconnect acknowledgement preserves active frame',settings,async()=>{await ops.locator('iframe').evaluate(el=>el.dataset.depthMarker='persistent');await ops.getByRole('button',{name:'重新连接',exact:true}).click();await ops.getByRole('status').getByText('已发送重连请求').waitFor();assert.equal(await ops.locator('iframe').getAttribute('data-depth-marker'),'persistent');await ops.getByRole('button',{name:'展开',exact:true}).click();await ops.getByRole('button',{name:'收起',exact:true}).click();assert.equal(await ops.locator('iframe').getAttribute('data-depth-marker'),'persistent');});
   await page.screenshot({path:`${out}/operations-${settings.width}-${settings.motion}.png`});
   await context.close();
  }
  assert.deepEqual(report.errors,[]);report.passed=true;
 } catch(error) { report.error=error.stack;if(activePage&&!activePage.isClosed())await activePage.screenshot({path:`${out}/failure.png`});throw error; }
 finally {await browser.close();fs.writeFileSync(`${out}/verification.json`,JSON.stringify(report,null,2));writeContrastSummary(out,report.contrast,target);}
 console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,errors:report.errors,intercepted:report.intercepted.length,forwardedMutations:report.forwardedMutations}));
})().catch(error=>{console.error(error);process.exitCode=1;});
