import {UploadQueue} from './upload-queue.mjs';
const $=id=>document.getElementById(id);
const displaySize=size=>size>=1024**2?`${(size/1024**2).toFixed(1)} MB`:`${Math.ceil(size/1024)} KB`;
const isPreview=name=>/\.(jpe?g|png|webp|gif|avif)$/i.test(name);

export function mountMediaLibrary({request,getPlatform,getRole,onBusy=()=>{}}) {
 const selected=new Map(),filesByPlatform=new Map(),rows=new Map();let refreshRevision=0,scan=null,attaching=false,scanPlatform=null,attachmentScanBusy=false;
 const selection=()=>{const p=getPlatform();if(!selected.has(p))selected.set(p,new Set());return selected.get(p);};
 function updateControls(){
   const operator=getRole()==='operator';
   $('files').disabled=!operator;$('videos').disabled=!operator;
   $('media-scan').disabled=!operator||attachmentScanBusy||attaching;
   $('media-attach').disabled=!operator||attaching||attachmentScanBusy||!scan?.scanId||!$('media-target').value||!selection().size;
   $('media-selected-count').textContent=`已选 ${selection().size} 项`;
   $('media-attach').textContent=attaching?'添加中…':'添加到页面';
   $('media-target').disabled=attaching;
   queue.pump();
 }
 async function upload(file,platform,{signal,onProgress}) {
   if(file.size>2*1024**3)throw Error('单文件不能超过2 GB');
   let ticket,offset=0;
   try {
     ticket=await request('uploads',{method:'POST',body:JSON.stringify({name:file.name,size:file.size,platform}),signal});
     while(offset<file.size){
       if(signal.aborted)throw new DOMException('已取消','AbortError');
       const end=Math.min(file.size,offset+ticket.chunkSize);let result;
       for(let attempt=0;attempt<3;attempt++){
         try{result=await request(`uploads/${ticket.id}`,{method:'PUT',headers:{'content-type':'application/octet-stream','x-upload-offset':String(offset)},body:file.slice(offset,end),signal});break;}
         catch(error){
           if(signal.aborted||[400,401,403,404,413].includes(error.status)||attempt===2)throw error;
           const current=await request(`uploads/${ticket.id}`,{signal});
           if(current.offset>offset){result=current;break;}
         }
       }
       if(!result||!Number.isSafeInteger(result.offset)||result.offset<=offset||result.offset>file.size)throw Error('上传响应异常');
       offset=result.offset;onProgress(offset/file.size*100);
       if(result.complete)return {name:result.name,size:file.size};
     }
     throw Error('未确认上传完成');
   } finally {
     if(ticket&&offset<file.size)await request(`uploads/${ticket.id}`,{method:'DELETE'}).catch(()=>{});
   }
 }
 const queue=new UploadQueue({upload,canStart:()=>getRole()==='operator',onChange:renderQueue,onComplete:item=>{
   if(!selected.has(item.platform))selected.set(item.platform,new Set());selected.get(item.platform).add(item.result.name);
   if(item.platform===getPlatform())void refresh();
 }});
 function renderQueue(){
   onBusy(queue.busy);const visible=queue.items.filter(x=>x.platform===getPlatform());
   $('upload-queue').hidden=!visible.length;
   for(const item of visible){
     let row=rows.get(item.id);
     if(!row){
       row=document.createElement('li');row.className='upload-row';const label=document.createElement('span');label.className='upload-row-copy';const title=document.createElement('b');title.textContent=item.file.name;
       const state=document.createElement('small');const progress=document.createElement('progress');progress.max=100;
       const action=document.createElement('button');action.className='upload-row-action';action.type='button';
       action.addEventListener('click',()=>{['failed','canceled'].includes(item.status)?queue.retry(item.id):queue.cancel(item.id)});
       label.append(title,state,progress);row.append(label,action);row.parts={state,progress,action};rows.set(item.id,row);$('upload-queue').append(row);
     }
     row.hidden=false;row.dataset.state=item.status;
     const {state,progress,action}=row.parts;
     state.textContent=item.status==='uploading'?`${Math.round(item.progress)}% · ${displaySize(item.file.size)}`:item.status==='done'?'已上传':item.status==='failed'?item.error:item.status==='canceled'?'已取消':'等待上传';
     progress.value=item.progress;progress.hidden=item.status!=='uploading';
     action.hidden=item.status==='done';action.textContent=['failed','canceled'].includes(item.status)?'重试':'取消';action.setAttribute('aria-label',`${action.textContent} ${item.file.name}`);
   }
   const ids=new Set(visible.map(x=>x.id));for(const [id,row]of rows)if(!ids.has(id))row.hidden=true;
   $('upload-status').textContent=visible.length?`${visible.filter(x=>x.status==='done').length}/${visible.length} 已上传${visible.some(x=>x.status==='failed')?' · 有失败项可重试':''}`:'';
   $('upload-clear').hidden=!visible.some(x=>['done','canceled'].includes(x.status));
   updateControls();
 }
 function add(files){
   if(getRole()!=='operator')return;
   const accepted=Array.from(files).filter(f=>/\.(jpe?g|png|webp|gif|avif|heic|heif|mp4|mov|m4v|webm)$/i.test(f.name));
   const count=queue.add(accepted,getPlatform());
   if(count<files.length)$('upload-status').textContent+=' · 部分文件类型不支持或队列已满';
 }
 for(const id of ['files','videos'])$(id).addEventListener('change',event=>{const files=Array.from(event.target.files??[]);event.target.value='';add(files);});
 $('upload-clear').addEventListener('click',()=>{queue.clearFinished();for(const [id,row]of rows)if(!queue.items.some(x=>x.id===id)){row.remove();rows.delete(id);}});
 const drop=$('media-dropzone');
 drop.addEventListener('dragover',event=>{event.preventDefault();drop.dataset.dragging='true';});
 drop.addEventListener('dragleave',()=>delete drop.dataset.dragging);
 drop.addEventListener('drop',event=>{event.preventDefault();delete drop.dataset.dragging;add(Array.from(event.dataTransfer?.files??[]));});
 function renderFiles(){
   const files=filesByPlatform.get(getPlatform())??[];const checked=selection();$('file-list').replaceChildren();
   $('media-empty').hidden=files.length>0;
   for(const file of files){
     const li=document.createElement('li');li.className='media-card';
     const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.checked=checked.has(file.name);input.setAttribute('aria-label',`选择 ${file.name}`);
     input.addEventListener('change',()=>{input.checked?checked.add(file.name):checked.delete(file.name);updateControls();});
     const thumb=document.createElement('span');thumb.className='media-thumbnail';
     if(isPreview(file.name)){const img=document.createElement('img');img.src=`./api/preview/${getPlatform()}/${encodeURIComponent(file.name)}`;img.alt='';img.loading='lazy';thumb.append(img);}else{thumb.textContent=/\.(heic|heif)$/i.test(file.name)?'照片':'视频';}
     const name=document.createElement('span');name.className='media-name';name.textContent=file.name;name.title=file.name;
     const size=document.createElement('small');size.textContent=displaySize(file.size);
     const download=document.createElement('a');download.href=`./api/download/${getPlatform()}/${encodeURIComponent(file.name)}`;download.textContent='下载';download.setAttribute('aria-label',`下载 ${file.name}`);
     label.append(input,thumb,name);li.append(label,size,download);$('file-list').append(li);
   }
   updateControls();
 }
 async function refresh(){
   const platform=getPlatform(),revision=++refreshRevision;
   try{const data=await request(`files/${platform}`);if(platform!==getPlatform()||revision!==refreshRevision)return;filesByPlatform.set(platform,data.files);const available=new Set(data.files.map(f=>f.name));for(const name of selection())if(!available.has(name))selection().delete(name);renderFiles();}
   catch(error){$('media-status').textContent=error.message;}
 }
 $('media-select-all').addEventListener('click',()=>{const set=selection(),files=filesByPlatform.get(getPlatform())??[];if(files.length&&files.every(f=>set.has(f.name)))set.clear();else for(const file of files)set.add(file.name);renderFiles();});
 $('media-refresh').addEventListener('click',()=>void refresh());
 $('media-scan').addEventListener('click',async()=>{
   if(getRole()!=='operator'||attaching||attachmentScanBusy)return;const platform=getPlatform();attachmentScanBusy=true;scan=null;updateControls();$('media-status').textContent='正在识别上传位置…';
   try{
     const result=await request(`browser/${platform}/media-scan`,{method:'POST',body:'{}'});if(platform!==getPlatform())return;scan=result;scanPlatform=platform;$('media-target').replaceChildren();
     for(const [i,field] of result.inputs.entries()){const option=document.createElement('option');option.value=field.id;option.textContent=`${field.label} · ${field.multiple?'多选':'单选'}${result.inputs.length>1?` ${i+1}`:''}`;$('media-target').append(option);}
     $('media-status').textContent=result.inputs.length?'选中素材后添加到页面':'请先打开平台的图片或视频上传页';
   }catch(error){if(platform===getPlatform())$('media-status').textContent=error.message;}
   finally{attachmentScanBusy=false;updateControls();}
 });
 $('media-target').addEventListener('change',updateControls);
 $('media-attach').addEventListener('click',async()=>{
   if(getRole()!=='operator'||attaching||!scan?.scanId||scanPlatform!==getPlatform())return;
   const names=[...selection()],platform=getPlatform(),inputId=$('media-target').value,field=scan.inputs.find(x=>x.id===inputId);
   if(!names.length)return;if(names.length>100){$('media-status').textContent='每次最多选择100项，平台可能有更低上限';return;}
   if(names.length>1&&!field?.multiple){$('media-status').textContent='当前平台控件仅支持单选，请选择多选上传位置';return;}
   attaching=true;updateControls();$('media-status').textContent='正在添加到平台页面…';
   try{const result=await request(`browser/${platform}/media-attach`,{method:'POST',body:JSON.stringify({scanId:scan.scanId,inputId,names})});if(platform!==getPlatform())return;$('media-status').textContent=`页面已接收 ${result.attachedCount} 项，请在平台确认上传结果`;selection().clear();renderFiles();}
   catch(error){if(platform===getPlatform())$('media-status').textContent=error.message;}
   finally{scan=null;attaching=false;updateControls();}
 });
 function reset(){refreshRevision++;scan=null;scanPlatform=null;$('media-target').replaceChildren();$('media-status').textContent='';renderFiles();renderQueue();}
 return {refresh,reset,updateControls,get busy(){return queue.busy||attaching||attachmentScanBusy;},queue};
}
