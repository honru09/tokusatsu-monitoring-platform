'use strict';
function publishInput(input) {
  const text = [input.title, input.description, input.deliveryText].filter(Boolean).join('\n\n');
  if (typeof input.id !== 'string' || !Number.isInteger(input.version) || input.version < 1 ||
      typeof input.title !== 'string' || !input.title.trim() || typeof input.description !== 'string' ||
      text.length > 1500 || !Number.isFinite(input.priceCny) || input.priceCny <= 0 ||
      !Array.isArray(input.imageUrls) || input.imageUrls.length < 1 || input.imageUrls.length > 9 ||
      !['free','distance','fixed','none'].includes(input.shippingMode ?? 'free'))
    throw new Error('请核对图片、售价及描述长度，闲鱼网页描述最多1500字');
  if (input.shippingMode === 'fixed' && (!Number.isFinite(input.shippingFeeCny) || input.shippingFeeCny < 0))
    throw new Error('请填写有效运费');
  return {...input, text, shippingMode:input.shippingMode ?? 'free'};
}
async function picture(url) {
  const target = new URL(url);
  if (target.protocol !== 'https:' || target.username || target.password ||
      !['mercdn.net','alicdn.com'].some(host=>target.hostname === host || target.hostname.endsWith(`.${host}`)))
    throw new Error('这张图片需在闲鱼发布页手动上传');
  const response = await fetch(target, {redirect:'error',signal:AbortSignal.timeout(12000)});
  const mimeType = response.headers.get('content-type')?.split(';')[0];
  if (!response.ok || !['image/jpeg','image/png','image/webp'].includes(mimeType)) throw new Error('商品图片暂时无法读取');
  if (Number(response.headers.get('content-length')) > 12*1024*1024) throw new Error('单张商品图片过大');
  const chunks=[]; let bytes=0;
  for await (const chunk of response.body) { bytes += chunk.length; if(bytes>12*1024*1024) throw new Error('单张商品图片过大'); chunks.push(Buffer.from(chunk)); }
  return {name:`product.${mimeType.split('/')[1]}`,mimeType,buffer:Buffer.concat(chunks)};
}
async function fillPublishForm(page, input) {
  const data = publishInput(input);
  const editor = page.locator('[contenteditable="true"][data-placeholder]');
  const file = page.locator('input[name="file"][type="file"]');
  await file.waitFor({state:'attached',timeout:15000});
  if (await editor.count() !== 1) throw new Error('发布页面结构有变化，请在闲鱼浏览器完成');
  await editor.fill(data.text);
  const prices = page.getByPlaceholder('0.00',{exact:true});
  await prices.nth(0).fill(data.priceCny.toFixed(2));
  const radioValue = {free:'0',distance:'1',fixed:'2',none:'3'}[data.shippingMode];
  await page.locator(`input[type="radio"][value="${radioValue}"]`).check();
  if (data.shippingMode === 'fixed') await prices.nth(2).fill(data.shippingFeeCny.toFixed(2));
  const files=[];
  for (const url of data.imageUrls) files.push(await picture(url));
  await file.setInputFiles(files);
  // The official uploader renders custom previews outside Ant's upload list.
  await page.waitForFunction(expected => {
    const previews = [...document.querySelectorAll('[class*="preview-container--"]')];
    return previews.length === expected && previews.every(preview => [...preview.children].some(image =>
      image instanceof HTMLImageElement && getComputedStyle(image).display !== 'none' &&
      image.width >= 80 && image.naturalWidth >= 32 && image.naturalHeight >= 32 &&
      /^https:\/\//.test(image.src) && new URL(image.src).hostname.endsWith('.alicdn.com') &&
      !/\.gif(?:$|\?)/.test(image.src)));
  }, files.length, {timeout:25000}).catch(()=>{throw new Error('图片尚未上传完成，请在闲鱼页面核查');});
  if (/上传失败|图片上传失败/.test(await page.locator('body').innerText())) throw new Error('图片上传未完成，请在闲鱼页面核查');
  const address = page.locator('[class*="address--"]').first();
  const location = await address.textContent().catch(()=> '');
  if (data.locationText && (!location || location.includes('请选择地址'))) {
    await address.click();
    const search = page.getByPlaceholder('搜索地点',{exact:true});
    if (await search.isVisible().catch(()=>false)) await search.fill(data.locationText);
  }
  await page.bringToFront();
  return {state:'prepared', message:'草稿已填入闲鱼，请核对所在地和图片后点击发布；完成后粘贴商品链接即可同步。'};
}
function createPublishPreparer({getStatus,createPage,fillForm=fillPublishForm}) {
  const pages=new Map();
  const prepare = async input => {
    const data=publishInput(input);
    const current=await getStatus();
    if(!current.authenticated)return {state:'login_required',message:'请先登录闲鱼'};
    for(const [key,value] of pages)if(value.page.isClosed())pages.delete(key);
    const key=`${current.accountLabel}:${data.id}:${data.version}`;
    const existing=pages.get(key);
    if(existing){await existing.page.bringToFront();return existing.result;}
    const page=await createPage();
    let result;
    try {
      await page.bringToFront();
      await page.goto('https://www.goofish.com/publish',{waitUntil:'domcontentloaded',timeout:15000});
      result=await fillForm(page,data);
    }catch(error){
      await page.bringToFront().catch(()=>{});
      result={state:'manual_required',message:error instanceof Error ? error.message : '请在闲鱼页面继续完成'};
    }
    pages.set(key,{page,result});
    if(pages.size>100)pages.delete(pages.keys().next().value);
    return result;
  };
  prepare.reset=()=>pages.clear();
  return prepare;
}
module.exports = {publishInput,fillPublishForm,createPublishPreparer};
