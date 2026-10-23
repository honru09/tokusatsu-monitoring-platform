"""Read-only public editor structure, excluding values, page text, tokens and query strings."""
import importlib.util
import json
from urllib.parse import urlparse
spec=importlib.util.spec_from_file_location('control','/usr/local/bin/browser-control.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
controller=m.BrowserControl()
for target in controller.targets():
    if not m.official(target.get('url','')):
        continue
    c=m.CDP(target)
    try:
        data=c.evaluate("""(() => {
          const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility==='visible'&&s.display!=='none'};
          const safe=e=>!['password','tel','email'].includes(e.type)&&!/密码|验证码|手机|电话|账号|password|token|secret|phone|email|account/i.test([e.placeholder,e.name,e.id,e.autocomplete].join(' '));
          return {language:navigator.language,languages:navigator.languages,docLanguage:document.documentElement.lang,focused:document.hasFocus(),visibility:document.visibilityState,
            fields:[...document.querySelectorAll('input,textarea,[contenteditable],[role=textbox]')].filter(safe).map(e=>({tag:e.tagName,type:e.type??null,role:e.getAttribute('role'),editable:e.getAttribute('contenteditable'),classes:e.className,placeholder:e.getAttribute('placeholder'),dataPlaceholder:e.getAttribute('data-placeholder'),label:e.getAttribute('aria-label'),visible:visible(e),maxLength:e.maxLength??null})),
            frames:[...document.querySelectorAll('iframe')].map(e=>{try{const u=new URL(e.src);return {host:u.hostname,path:u.pathname}}catch{return {host:'',path:''}}}),
            editorLinks:[...document.querySelectorAll('a[href]')].map(e=>{try{const u=new URL(e.href);return /publish|upload|editor/.test(u.pathname)?{host:u.hostname,path:u.pathname}:null}catch{return null}}).filter(Boolean).slice(0,12)
          };
        })()""")
        print(json.dumps({'host':urlparse(target['url']).hostname,'path':urlparse(target['url']).path,**data},ensure_ascii=False))
    finally:c.close()
