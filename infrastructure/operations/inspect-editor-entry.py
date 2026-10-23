import importlib.util
import json
from urllib.parse import urlparse
spec=importlib.util.spec_from_file_location('control','/usr/local/bin/browser-control.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
for target in m.BrowserControl().targets():
    if not m.official(target.get('url','')):continue
    c=m.CDP(target)
    try:
        result=c.evaluate("""(() => ({
          entries:[...document.querySelectorAll('a,button,[role=button],span')].filter(e=>e.getBoundingClientRect().width>0&&/^(发布笔记|发布视频|发布作品|发布图文|Publish|Post|Upload|English|简体中文|中文)$/.test((e.innerText||'').trim())).map(e=>({tag:e.tagName,label:e.innerText,classes:e.className,href:e.tagName==='A'?new URL(e.href).pathname:null})).slice(0,20),
          languageKeys:Object.keys(localStorage).filter(k=>/^(language|lang|locale|i18nextLng|i18n_locale)$/i.test(k)).map(k=>({key:k,value:/^[a-zA-Z_-]{2,12}$/.test(localStorage.getItem(k)||'')?localStorage.getItem(k):'not-language-code'}))
        }))()""")
        print(json.dumps({'host':urlparse(target['url']).hostname,'path':urlparse(target['url']).path,**result},ensure_ascii=False))
    finally:c.close()
