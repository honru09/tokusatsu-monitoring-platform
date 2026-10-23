const fs=require('node:fs');
const zlib=require('node:zlib');
function decodePng(bytes){
 let width,height,type,depth;const parts=[];
 for(let offset=8;offset<bytes.length;){const size=bytes.readUInt32BE(offset),kind=bytes.toString('ascii',offset+4,offset+8),data=bytes.subarray(offset+8,offset+8+size);if(kind==='IHDR'){width=data.readUInt32BE(0);height=data.readUInt32BE(4);depth=data[8];type=data[9];}if(kind==='IDAT')parts.push(data);offset+=12+size;}
 if(depth!==8||![2,6].includes(type))throw Error(`Unsupported screenshot PNG ${depth}/${type}`);
 const channels=type===6?4:3,rowBytes=width*channels,packed=zlib.inflateSync(Buffer.concat(parts)),pixels=Buffer.alloc(rowBytes*height);
 const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
 for(let y=0;y<height;y++){const filter=packed[y*(rowBytes+1)];for(let x=0;x<rowBytes;x++){const a=x>=channels?pixels[y*rowBytes+x-channels]:0,b=y?pixels[(y-1)*rowBytes+x]:0,c=y&&x>=channels?pixels[(y-1)*rowBytes+x-channels]:0,v=packed[y*(rowBytes+1)+1+x];pixels[y*rowBytes+x]=(v+(filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):filter===4?paeth(a,b,c):0))&255;}}
 return {width,height,at(x,y){x=Math.max(0,Math.min(width-1,Math.round(x)));y=Math.max(0,Math.min(height-1,Math.round(y)));const i=(y*width+x)*channels;return [...pixels.subarray(i,i+3)];}};
}
function rgba(value){const numbers=value.match(/[\d.]+/g)?.map(Number)||[];return {rgb:numbers.slice(0,3),alpha:numbers[3]??1};}
function luminance(rgb){return rgb.map(value=>{const c=value/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;}).reduce((sum,value,i)=>sum+value*[.2126,.7152,.0722][i],0);}
function ratio(foreground,background){const a=luminance(foreground),b=luminance(background);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);}
async function recordContrast(page,out,id,settings,specs){
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const evidence=[];
 for(const spec of specs){const locator=page.locator(spec.selector).first();if(!(await locator.isVisible()))continue;await page.waitForFunction(selector=>{let opacity=1;for(let node=document.querySelector(selector);node;node=node.parentElement)opacity*=Number(getComputedStyle(node).opacity);return opacity>=.999;},spec.selector,{timeout:3000});const value=await locator.evaluate(el=>{const style=getComputedStyle(el),rect=el.getBoundingClientRect(),parents=[];let opacity=1;for(let node=el;node;node=node.parentElement){const s=getComputedStyle(node);opacity*=Number(s.opacity);if(s.backgroundColor!=='rgba(0, 0, 0, 0)'||s.backgroundImage!=='none')parents.push({tag:node.tagName,className:String(node.className),backgroundColor:s.backgroundColor,backgroundImage:s.backgroundImage});}const padded=parseFloat(style.paddingTop)>2;return {color:style.color,backgroundColor:style.backgroundColor,backgroundImage:style.backgroundImage,fontSize:parseFloat(style.fontSize),fontWeight:Number(style.fontWeight),opacity,rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},sampleY:padded?rect.y+Math.min(4,parseFloat(style.paddingTop)-1):rect.bottom+1,parents:parents.slice(0,5)};});evidence.push({...spec,...value});}
 const screenshot=`${out}/contrast-${id}.png`,image=decodePng(await page.screenshot({path:screenshot}));
 return evidence.filter(row=>row.sampleY>=0&&row.sampleY<image.height&&row.rect.x>=0&&row.rect.x+row.rect.width<=image.width+1).map(row=>{const color=rgba(row.color),alpha=color.alpha*row.opacity,backgrounds=[.2,.5,.8].map(part=>image.at(row.rect.x+row.rect.width*part,row.sampleY)),ratios=backgrounds.map(bg=>ratio(color.rgb.map((value,i)=>value*alpha+bg[i]*(1-alpha)),bg)),threshold=row.fontSize>=24||(row.fontSize>=18.66&&row.fontWeight>=700)?3:4.5;return {...row,settings,screenshot,sampledBackgrounds:backgrounds,ratios:ratios.map(n=>Number(n.toFixed(3))),minimumRatio:Number(Math.min(...ratios).toFixed(3)),threshold,pass:Math.min(...ratios)>=threshold};});
}
function writeContrastSummary(out,rows,target){
 fs.writeFileSync(`${out}/contrast.json`,JSON.stringify({target,method:'Computed text color, actual ancestor opacity, rendered PNG background sampled at three documented blank positions adjacent to text or inside padded surface; WCAG relative luminance formula. Gradients/translucency are read from rendered pixels, not treated as solid white.',scope:'Shared header and primary navigation, new inventory success receipt, and focused AI product entry. This is a bounded sample, not a whole-site pixel audit.',rows},null,2));
 const table=rows.map(row=>`| ${row.name} | ${row.settings.width} / ${row.settings.motion} | ${row.color} | ${row.sampledBackgrounds.map(c=>`rgb(${c.join(',')})`).join(' · ')} | ${row.minimumRatio.toFixed(2)} : 1 | ${row.pass?'PASS':'不足'} |`).join('\n');
 fs.writeFileSync(`${out}/contrast-summary.md`,`# 生产界面对比度抽样\n\n入口：${target}\n\n只测共享页头、导航、新库存回执、AI 读取入口与标题。文本颜色来自实际 computed style；透明度累计包含祖先。背景使用当前浏览器 PNG 在记录位置的空白区域采样，保留白色、浅蓝及半透明材质真实合成效果。每条数据含选择器、位置、computed 材质、截图与计算结果，见 contrast.json。此摘要不代表全站所有像素或全部交互状态。\n\n普通文字目标 4.5 : 1；24px 普通文字或 18.66px/700 粗体目标 3 : 1。\n\n| 元素 | 宽度 / motion | computed 前景 | rendered 背景 | 最低对比度 | 结果 |\n| --- | --- | --- | --- | --- | --- |\n${table}\n`);
}
module.exports={recordContrast,writeContrastSummary};
