export class UploadQueue {
  constructor({upload,onChange=()=>{},onComplete=()=>{},canStart=()=>true,concurrency=2,maxFiles=100}) {
    Object.assign(this,{upload,onChange,onComplete,canStart,concurrency,maxFiles});this.items=[];this.running=0;this.counter=0;
  }
  get busy(){return this.items.some(x=>['queued','uploading'].includes(x.status));}
  add(files,platform){
    let added=0;
    for(const file of files){
      if(this.items.filter(x=>!['done','canceled'].includes(x.status)).length>=this.maxFiles)break;
      if(!file||file.size<=0)continue;
      if(this.items.some(x=>x.platform===platform&&x.file===file&&x.status!=='canceled'))continue;
      this.items.push({id:`upload-${++this.counter}`,file,platform,status:'queued',progress:0,error:'',result:null,controller:null});added++;
    }
    this.onChange(this);this.pump();return added;
  }
  pump(){
    while(this.running<this.concurrency&&this.canStart()){
      const item=this.items.find(x=>x.status==='queued');if(!item)break;
      item.status='uploading';item.controller=new AbortController();this.running++;this.onChange(this);
      Promise.resolve().then(()=>this.upload(item.file,item.platform,{signal:item.controller.signal,onProgress:progress=>{item.progress=progress;this.onChange(this);}}))
        .then(result=>{if(item.status==='canceled')return;item.result=result;item.progress=100;item.status='done';this.onComplete(item);})
        .catch(error=>{if(item.status==='canceled'||error.name==='AbortError'){item.status='canceled';return;}item.status='failed';item.error=error.message||'上传失败';})
        .finally(()=>{item.controller=null;this.running--;this.onChange(this);this.pump();});
    }
  }
  cancel(id){const item=this.items.find(x=>x.id===id);if(!item||!['queued','uploading'].includes(item.status))return;item.status='canceled';item.controller?.abort();this.onChange(this);}
  retry(id){const item=this.items.find(x=>x.id===id);if(!item||!['failed','canceled'].includes(item.status))return;item.status='queued';item.progress=0;item.error='';this.onChange(this);this.pump();}
  clearFinished(){this.items=this.items.filter(x=>!['done','canceled'].includes(x.status));this.onChange(this);}
}
