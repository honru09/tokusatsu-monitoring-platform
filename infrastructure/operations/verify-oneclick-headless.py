"""Full controller test in a disposable network-isolated Chromium, with no user profile."""
import importlib.util
import json
import os
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path

spec=importlib.util.spec_from_file_location('control',Path(__file__).with_name('browser-control.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
fixture='''<!doctype html><meta charset="utf-8"><body><button id="unrelated">其它位置</button>
<input placeholder="填写标题会有更多赞哦" maxlength="30"><div style="height:900px"></div>
<div class="tiptap ProseMirror" contenteditable="true" data-placeholder="添加正文" style="min-height:100px">原始正文</div>
<button id="publish">发布</button><script>
window.published=0;document.querySelector('#publish').onclick=()=>published++;
document.querySelector('#unrelated').focus();
document.querySelector('input').addEventListener('input',e=>{if(!e.isTrusted)e.target.value='untrusted-rejected'});
</script>'''
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8');self.end_headers();self.wfile.write(fixture.encode())
    def log_message(self,*_):pass
server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
threading.Thread(target=server.serve_forever,daemon=True).start()
url=f'http://127.0.0.1:{server.server_port}/editor'
# Only the disposable fixture is allowlisted; production official() remains unmodified on disk.
m.official=lambda candidate:candidate==url
os.makedirs('/tmp/oneclick-home',exist_ok=True)
browser=subprocess.Popen(['chromium','--headless=new','--disable-gpu','--no-first-run','--disable-dev-shm-usage','--user-data-dir=/tmp/oneclick-profile','--remote-debugging-port=9222',url],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,env={**os.environ,'HOME':'/tmp/oneclick-home'})
control=m.BrowserControl()
try:
    for _ in range(100):
        try:
            pages=control.targets()
            if any(p['url']==url for p in pages):break
        except Exception:pass
        time.sleep(.1)
    else:raise RuntimeError('Isolated Chromium unavailable')
    target=next(p for p in pages if p['url']==url);cdp=m.CDP(target)
    try:
        for _ in range(50):
            if cdp.evaluate("document.querySelectorAll('input,[contenteditable]').length===2"):break
            time.sleep(.1)
        assert cdp.evaluate("document.activeElement.id==='unrelated'")
        result=control.page_action('page-import',{'title':'中文标题','body':'第一段\n第二段'})
        assert result.get('verified') and result.get('count')==2,result
        assert cdp.evaluate("document.querySelector('input').value==='中文标题'")
        assert cdp.evaluate("document.querySelector('[contenteditable]').innerText.replace(/\\r/g,'').trim()==='第一段\\n第二段'")
        assert cdp.evaluate('window.published===0')
        print(json.dumps({'noInitialCaret':True,'offscreenBody':True,'trustedNativeInput':True,'controllerOneClick':True,'titleAndBodyVerified':True,'noPublication':True}))
    finally:cdp.close()
finally:
    browser.terminate();browser.wait(timeout=10);server.shutdown()
