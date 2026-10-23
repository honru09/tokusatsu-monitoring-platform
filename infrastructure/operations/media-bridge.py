"""Constrained attachment bridge: only completed files under the mounted material root."""
import json
import secrets
import time
from pathlib import Path

IMAGE={'.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.gif':'image/gif','.avif':'image/avif','.heic':'image/heic','.heif':'image/heif'}
MIME={**IMAGE,'.mp4':'video/mp4','.mov':'video/quicktime','.m4v':'video/x-m4v','.webm':'video/webm'}

def media_paths(names,root):
    if not isinstance(names,list) or not 1<=len(names)<=100 or any(not isinstance(n,str) for n in names) or len(set(names))!=len(names):raise ValueError('invalid_files')
    root=root.resolve(strict=True);files=[]
    for name in names:
        if not name or len(name)>220 or Path(name).name!=name or any(c in name for c in '/\\:\x00') or Path(name).suffix.lower() not in MIME:raise ValueError('invalid_files')
        path=root/name
        if path.is_symlink():raise ValueError('invalid_files')
        path=path.resolve(strict=True)
        if path.parent!=root or not path.is_file() or not 0<path.stat().st_size<=2*1024**3:raise ValueError('invalid_files')
        files.append(str(path))
    return files

def accepts(accept,names):
    patterns=[p.strip().lower() for p in accept.split(',') if p.strip()]
    return not patterns or all(any(p==Path(name).suffix.lower() or p==MIME[Path(name).suffix.lower()] or p==MIME[Path(name).suffix.lower()].split('/')[0]+'/*' or p=='*/*' for p in patterns) for name in names)

class MediaBridge:
    def __init__(self,cdp,official,targets,root=Path('/materials')):
        self.cdp,self.official,self.targets,self.root=cdp,official,targets,root
        self.scans={}

    def scan(self):
        candidates=[]
        for target in self.targets():
            if not self.official(target.get('url','')):continue
            c=self.cdp(target)
            try:
                nonce=secrets.token_urlsafe(18)
                result=c.evaluate("""(() => {const nonce=NONCE;return {url:location.href,visible:document.visibilityState==='visible',inputs:[...document.querySelectorAll('input[type=file]')].filter(e=>!e.disabled).map((e,i)=>{const id=nonce+'-'+i;e.setAttribute('data-kamen-media-input',id);const accept=e.accept||'';const kind=/video/i.test(accept)&&!/image/i.test(accept)?'video':/image|\\.jpe?g|\\.png|\\.webp/i.test(accept)&&!/video/i.test(accept)?'image':'media';return {id,accept,multiple:e.multiple,kind,label:kind==='image'?'图片':kind==='video'?'视频':'附件'}})}})()""".replace('NONCE',json.dumps(nonce)))
                if result and result['url']==target['url'] and result['inputs']:candidates.append((target,result))
            finally:c.close()
        visible=[candidate for candidate in candidates if candidate[1]['visible']]
        chosen=visible if visible else candidates
        if len(chosen)!=1:return {'inputs':[],'code':'open_upload_page' if not chosen else 'ambiguous_page'}
        target,result=chosen[0];scan_id=secrets.token_urlsafe(18)
        self.scans={k:v for k,v in self.scans.items() if v['expires']>time.time()}
        if len(self.scans)>=8:self.scans.pop(next(iter(self.scans)))
        self.scans[scan_id]={'target':target['id'],'url':target['url'],'inputs':result['inputs'],'expires':time.time()+300}
        return {'scanId':scan_id,'inputs':result['inputs']}

    def attach(self,payload):
        scan=self.scans.get(payload.get('scanId',''))
        if not scan or scan['expires']<time.time():return {'ok':False,'code':'rescan'}
        field=next((f for f in scan['inputs'] if f['id']==payload.get('inputId')),None)
        if not field:return {'ok':False,'code':'rescan'}
        names=payload.get('names');files=media_paths(names,self.root)
        if len(files)>1 and not field['multiple']:return {'ok':False,'code':'single_input'}
        if not accepts(field['accept'],names):return {'ok':False,'code':'unsupported_type'}
        target=next((t for t in self.targets() if t['id']==scan['target'] and t['url']==scan['url'] and self.official(t['url'])),None)
        if not target:return {'ok':False,'code':'rescan'}
        c=self.cdp(target)
        try:
            args={'url':scan['url'],'id':field['id'],'multiple':field['multiple'],'accept':field['accept']}
            expression="""(() => {const a=ARGS;if(location.href!==a.url)throw Error('page changed');const e=document.querySelector('[data-kamen-media-input="'+a.id+'"]');if(!e||e.type!=='file'||e.disabled||e.multiple!==a.multiple||e.accept!==a.accept)throw Error('input changed');if(e.files?.length)throw Error('existing selection');return e})()""".replace('ARGS',json.dumps(args))
            reply=c.call('Runtime.evaluate',{'expression':expression,'returnByValue':False})
            object_id=reply.get('result',{}).get('objectId')
            if not object_id or 'exceptionDetails' in reply:return {'ok':False,'code':'rescan_or_clear'}
            c.call('Target.activateTarget',{'targetId':target['id']})
            c.call('DOM.setFileInputFiles',{'files':files,'objectId':object_id})
            verification=c.call('Runtime.callFunctionOn',{'objectId':object_id,'functionDeclaration':'function(){return Array.from(this.files||[],f=>f.name)}','returnByValue':True})
            received=verification.get('result',{}).get('value')
            # A successful dispatch must not be replayed silently: it can duplicate platform attachments.
            del self.scans[payload['scanId']]
            if received!=names:return {'ok':False,'code':'attachment_uncertain'}
            return {'ok':True,'attachedCount':len(names),'stage':'input_received'}
        finally:c.close()
