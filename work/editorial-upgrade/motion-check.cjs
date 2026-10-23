const { chromium } = require('../../workers/crawlers/node_modules/playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const target = process.env.EDITORIAL_UI_URL || 'http://127.0.0.1:3105';
const directory = path.resolve('work/editorial-upgrade');
const report = { target, startedAt: new Date().toISOString(), runs: [] };
const items = Array.from({length:80}, (_, index) => ({
  id:`motion-${index}`, sourceUrl:`https://example.org/motion-${index}`,
  titleRaw:`S.H.Figuarts 仮面ライダー 完整配件 商品 ${index+1}`,
  titleZh:`S.H.Figuarts 假面骑士 完整配件 商品 ${index+1}`,
  priceCurrent:1000+index*100, priceTotalEst:1000+index*100, shippingFee:0,
  detectedAt:'2026-10-09T01:00:00Z', lastSeenAt:'2026-10-09T01:00:00Z',
  updatedAt:'2026-10-09T01:00:00Z', listingType:index<40?'auction':'direct',
  auctionEndAt:index<40?'2026-10-14T01:00:00Z':null,
  categoryIp:'kamen-rider',categoryToyType:'figure',manufacturer:'Bandai',
  conditionGrade:'used',channel:'online',confidence:1,needsReview:false,
  status:'active',favorite:true,ignored:false,note:null,quantityEst:1,
  source:{key:'mercari',displayName:'Mercari'},
  seller:{id:'motion-seller',name:'卖家',sellerType:'individual'},
  images:[{url:`${target}/brand-icon.svg`,position:0}],translationStatus:'completed',
}));
async function snapshot(page){
  return page.evaluate(()=>{
    const container=document.querySelector('.procurement-content');
    const inner=container && container.scrollHeight>container.clientHeight+1 && /auto|scroll/.test(getComputedStyle(container).overflowY);
    const owner=inner?container:document.scrollingElement;
    const bar=document.querySelector('.editorial-reading-progress');
    const matrix=bar?new DOMMatrixReadOnly(getComputedStyle(bar).transform):null;
    return {owner:inner?'content':'document',top:owner.scrollTop,length:owner.scrollHeight-owner.clientHeight,progress:matrix?.a,visible:bar?getComputedStyle(bar).visibility:null,overflow:document.documentElement.scrollWidth>innerWidth+1};
  });
}
async function scroll(page,top){
  await page.evaluate(top=>{
    const container=document.querySelector('.procurement-content');
    const inner=container && container.scrollHeight>container.clientHeight+1 && /auto|scroll/.test(getComputedStyle(container).overflowY);
    (inner?container:window).scrollTo({top,behavior:'instant'});
  },top);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.waitForFunction(()=>{
    const c=document.querySelector('.procurement-content'),el=document.querySelector('.editorial-reading-progress');
    const inner=c&&c.scrollHeight>c.clientHeight+1&&/auto|scroll/.test(getComputedStyle(c).overflowY);
    const owner=inner?c:document.scrollingElement,length=owner.scrollHeight-owner.clientHeight;
    return !el||length<=1||Math.abs(new DOMMatrixReadOnly(getComputedStyle(el).transform).a-owner.scrollTop/length)<0.0001;
  });
}
async function settled(page,selector){
  await page.waitForFunction(selector=>[...document.querySelectorAll(selector)].every(el=>{
    const style=getComputedStyle(el);
    return style.opacity==='1' && (style.transform==='none'||new DOMMatrixReadOnly(style.transform).m42===0);
  }),selector);
}
async function check(run,name,fn){
  try {run.checks.push({name,pass:true,...await fn()});}
  catch(error){run.checks.push({name,pass:false,error:error.message});console.error(run.name,name,error.message);}
}
(async()=>{
  const accounts=await (await fetch(`${target}/backend/collaboration/accounts`)).json();
  const actor=accounts.accounts[0].id;
  const browser=await chromium.launch({headless:true,channel:'chrome'});
  try {
    for(const settings of [
      {name:'390-normal',viewport:{width:390,height:844},reducedMotion:'no-preference'},
      {name:'390-reduce',viewport:{width:390,height:844},reducedMotion:'reduce'},
      {name:'320-short',viewport:{width:320,height:568},reducedMotion:'no-preference'},
      {name:'1440-long',viewport:{width:1440,height:1000},reducedMotion:'no-preference'},
    ].filter(settings=>!process.env.MOTION_ONLY||settings.name===process.env.MOTION_ONLY)){
      const context=await browser.newContext(settings);
      const run={name:settings.name,viewport:settings.viewport,reducedMotion:settings.reducedMotion,checks:[],blocked:[],errors:[]};
      report.runs.push(run);
      await context.addInitScript(actor=>{
        localStorage.setItem('kamen-procurement-manager-v1',actor);
        window.__entryChanges=[];
        new MutationObserver(records=>records.forEach(record=>{
          if(record.type==='attributes' && record.target.matches('[data-scroll-entry]'))
            window.__entryChanges.push({heading:record.target.querySelector('h3')?.textContent,old:record.oldValue,new:record.target.getAttribute('data-entered')});
        })).observe(document,{subtree:true,attributes:true,attributeFilter:['data-entered'],attributeOldValue:true});
      },actor);
      const page=await context.newPage();
      page.on('pageerror',error=>run.errors.push(error.message));
      await page.route('**/*',async route=>{
        const request=route.request();const url=new URL(request.url());
        const suffix=url.pathname.replace(/^\/backend/,'');
        const json=(data,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(data)});
        const model=/^\/analysis(?:\/|$)|^\/ai(?:\/|$)|\/(translate|predict|models?|chat)(?:\/|$)/.test(suffix);
        if(request.method()!=='GET'||model){run.blocked.push({method:request.method(),path:suffix,reason:model?'model':'write'});return json({message:'独立 UI 验证禁止正式写入和模型调用'},403);}
        if(!url.pathname.startsWith('/backend/') && url.port!=='3001')return route.continue();
        if(suffix==='/collaboration/accounts')return json(accounts);
        if(suffix==='/items'){
          let collection=items;
          if(url.searchParams.has('listingType'))collection=collection.filter(item=>item.listingType===url.searchParams.get('listingType'));
          const offset=Number(url.searchParams.get('offset')||0),limit=Number(url.searchParams.get('limit')||100);
          return json({items:collection.slice(offset,offset+limit),total:collection.length,facets:{auction:40,direct:40,unknown:0},serverTime:new Date().toISOString()});
        }
        if(suffix==='/items/changes')return json({changes:[],serverTime:new Date().toISOString()});
        if(suffix==='/items/purchases')return json({items:[],total:0,bundles:[],standalone:[]});
        if(suffix==='/cart')return json({items:[],count:0,cartId:'motion-cart',updatedAt:new Date().toISOString()});
        return route.continue();
      });
      await page.goto(`${target}/?workspace=catalog`,{waitUntil:'domcontentloaded'});
      await page.locator('.js-product-card').first().waitFor();
      await scroll(page,0);
      await check(run,'real scroll increases reading progress',async()=>{
        const before=await snapshot(page);assert.ok(before.length>200);
        await page.mouse.move(settings.viewport.width/2,settings.viewport.height-150);
        await page.mouse.wheel(0,500);
        await page.waitForFunction(()=>{const el=document.querySelector('.editorial-reading-progress');return el&&new DOMMatrixReadOnly(getComputedStyle(el).transform).a>0;});
        const after=await snapshot(page);assert.ok(after.top>before.top);assert.ok(after.progress>before.progress);
        assert.ok(Math.abs(after.progress-after.top/after.length)<0.01);
        return {before,after};
      });
      await check(run,'workspace round trip restores real scroll and progress',async()=>{
        await scroll(page,700);const before=await snapshot(page);
        await page.getByRole('button',{name:'工作台',exact:true}).click();
        await page.getByRole('heading',{name:'工作台',exact:true}).waitFor();
        await page.getByRole('button',{name:/^商品库/}).click();
        await page.locator('.js-product-card').first().waitFor();
        await page.waitForFunction(top=>{const c=document.querySelector('.procurement-content');const inner=c&&c.scrollHeight>c.clientHeight+1&&/auto|scroll/.test(getComputedStyle(c).overflowY);return Math.abs((inner?c:document.scrollingElement).scrollTop-top)<2;},before.top);
        try {await page.waitForFunction(progress=>{const el=document.querySelector('.editorial-reading-progress');return el&&Math.abs(new DOMMatrixReadOnly(getComputedStyle(el).transform).a-progress)<0.01;},before.progress);}catch(error){throw new Error(`${error.message}: ${JSON.stringify({before,after:await snapshot(page)})}`);}
        const after=await snapshot(page);assert.ok(Math.abs(before.top-after.top)<2);assert.ok(Math.abs(before.progress-after.progress)<0.01);
        return {before,after};
      });
      await check(run,'catalog toolbar remains visible during scroll',async()=>{
        await scroll(page,800);
        const detail=await page.locator('.catalog-toolbar').evaluate(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);const c=document.querySelector('.procurement-content');const inner=c&&c.scrollHeight>c.clientHeight+1&&/auto|scroll/.test(getComputedStyle(c).overflowY);return {position:s.position,configuredTop:s.top,top:r.top,bottom:r.bottom,height:r.height,origin:inner?c.getBoundingClientRect().top+parseFloat(getComputedStyle(c).paddingTop):0};});
        assert.equal(detail.position,'sticky');assert.ok(detail.top>=0&&detail.bottom<settings.viewport.height-64);
        assert.ok(Math.abs(detail.top-detail.origin-parseFloat(detail.configuredTop))<2,JSON.stringify(detail));
        return detail;
      });
      await check(run,'filter Escape restores trigger focus',async()=>{
        await page.locator('.catalog-filter-button').click();
        await page.getByRole('dialog',{name:'采购筛选器'}).waitFor();
        const initial=await page.evaluate(()=>document.activeElement?.getAttribute('aria-label'));
        assert.equal(initial,'关闭筛选器');
        await page.keyboard.press('Escape');
        await page.getByRole('dialog',{name:'采购筛选器'}).waitFor({state:'hidden'});
        const restored=await page.locator('.catalog-filter-button').evaluate(el=>el===document.activeElement);
        assert.equal(restored,true);return {initial,restored};
      });
      await page.getByRole('button',{name:'工作台',exact:true}).click();
      await page.getByRole('heading',{name:'工作台',exact:true}).waitFor();
      await scroll(page,0);
      await check(run,'workbench staged entrance is once and reduced motion has no displacement',async()=>{
        const entries=page.locator('[data-scroll-entry]');await entries.first().waitFor();
        const initial=await entries.evaluateAll(els=>els.map(el=>({heading:el.querySelector('h3').textContent,entered:el.dataset.entered,transform:getComputedStyle(el).transform,opacity:getComputedStyle(el).opacity})));
        if(settings.reducedMotion==='reduce'){
          assert.ok(initial.every(el=>el.transform==='none'&&el.opacity==='1'));
        }else if(settings.viewport.width<600){assert.ok(initial.some(el=>el.entered==='false'&&new DOMMatrixReadOnlyShim(el.transform).y===8));}
        for(let index=0;index<3;index++)await entries.nth(index).scrollIntoViewIfNeeded();
        await page.waitForFunction(reduce=>reduce||[...document.querySelectorAll('[data-scroll-entry]')].every(el=>el.dataset.entered==='true'),settings.reducedMotion==='reduce');
        await settled(page,'[data-scroll-entry]');
        const changes=await page.evaluate(()=>window.__entryChanges.filter(change=>change.old==='false').length);
        await scroll(page,0);await entries.nth(2).scrollIntoViewIfNeeded();await settled(page,'[data-scroll-entry]');
        const repeated=await page.evaluate(()=>window.__entryChanges.filter(change=>change.old==='false').length);
        assert.equal(changes,repeated);
        if(settings.reducedMotion==='reduce')assert.equal(changes,0);
        return {initial,triggerCount:changes,afterRevisit:repeated};
      });
      await check(run,'mobile workbench section heading is sticky',async()=>{
        if(settings.viewport.width>=600)return {applicable:false};
        const stage=page.locator('[data-scroll-entry]').nth(1),heading=stage.locator('header');
        const rect=await stage.boundingBox(),current=await snapshot(page);
        await scroll(page,current.top+rect.y-68+60);
        const detail=await heading.evaluate(el=>{const r=el.getBoundingClientRect();return {position:getComputedStyle(el).position,configuredTop:getComputedStyle(el).top,top:r.top,height:r.height};});
        assert.equal(detail.position,'sticky');assert.ok(Math.abs(detail.top-parseFloat(detail.configuredTop))<2,JSON.stringify(detail));
        return detail;
      });
      await page.screenshot({path:path.join(directory,`motion-workbench-${settings.name}.png`),fullPage:false});
      await page.getByRole('button',{name:/^收藏/}).click();
      const tabs=page.getByRole('tablist',{name:'收藏商品类型'}).getByRole('tab');await tabs.first().waitFor();
      await check(run,'favorites Left Right Home End uses roving selection and focus',async()=>{
        await tabs.first().focus();
        const sequence=[];
        for(const [key,index] of [['ArrowRight',1],['ArrowLeft',0],['End',1],['Home',0],['ArrowLeft',1],['ArrowRight',0]]){
          await page.keyboard.press(key);
          const state=await tabs.evaluateAll(els=>els.map(el=>({selected:el.getAttribute('aria-selected'),tabIndex:el.tabIndex,focused:el===document.activeElement})));
          assert.equal(state[index].selected,'true');assert.equal(state[index].tabIndex,0);assert.equal(state[index].focused,true);
          assert.equal(state[1-index].selected,'false');assert.equal(state[1-index].tabIndex,-1);
          sequence.push({key,state});
        }
        return {sequence};
      });
      await check(run,'no horizontal overflow or uncaught browser errors',async()=>{
        assert.equal((await snapshot(page)).overflow,false);assert.deepEqual(run.errors,[]);return {errors:run.errors};
      });
      await page.screenshot({path:path.join(directory,`motion-${settings.name}.png`),fullPage:false});
      await context.close();
      console.log(settings.name,run.checks.filter(check=>check.pass).length+'/'+run.checks.length);
    }
  }finally{
    await browser.close();report.completedAt=new Date().toISOString();
    report.passed=report.runs.every(run=>run.checks.every(check=>check.pass));
    fs.writeFileSync(path.join(directory,'motion-check.json'),JSON.stringify(report,null,2));
  }
  if(!report.passed)process.exitCode=1;
})().catch(error=>{console.error(error);fs.writeFileSync(path.join(directory,'motion-check.json'),JSON.stringify({...report,fatal:error.stack},null,2));process.exitCode=1;});
function DOMMatrixReadOnlyShim(transform){this.y=transform==='none'?0:Number(transform.slice(7,-1).split(',')[5]);}
