const {chromium}=require('../workers/crawlers/node_modules/playwright-core');
(async()=>{
 const b=await chromium.connectOverCDP('http://127.0.0.1:9332'); const p=b.contexts()[0].pages().find(p=>p.url()==='https://www.goofish.com/publish') || await b.contexts()[0].newPage();
 try {
 await p.goto('https://www.goofish.com/publish',{waitUntil:'domcontentloaded',timeout:20000});
 await p.locator('input[name="file"]').waitFor({state:'attached',timeout:12000});
 const details=await p.locator('input,textarea,[contenteditable],button[type="submit"]').evaluateAll(els=>els.map(e=>({tag:e.tagName,type:e.type,accept:e.accept,placeholder:e.placeholder,role:e.getAttribute('role'),class:e.className,outer:e.outerHTML.slice(0,900),parent:e.parentElement?.outerHTML.slice(0,1500)})));
 console.log(JSON.stringify(details,null,2));
 console.log('ADDRESS_CONTROL',await p.getByText('请选择地址',{exact:true}).evaluate(e=>e.outerHTML+'\n'+e.parentElement.outerHTML.slice(0,1600)));
 await p.screenshot({path:'work/xianyu-publish-controls.png',fullPage:true});
 } finally {await p.close(); await b.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
