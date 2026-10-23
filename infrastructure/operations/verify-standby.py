import importlib.util
import json
import urllib.request
from pathlib import Path
spec=importlib.util.spec_from_file_location('control','/usr/local/bin/browser-control.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
controller=m.BrowserControl()
def post(action):
    req=urllib.request.Request('http://127.0.0.1:5901/'+action,data=b'{}',headers={'Authorization':'Bearer '+Path('/control/token').read_text().strip(),'Content-Type':'application/json'})
    with urllib.request.urlopen(req,timeout=20) as r:return json.load(r)
original={p['id'] for p in controller.targets() if m.official(p.get('url',''))}
assert original
post('park');post('park')
targets=controller.targets();assert len([p for p in targets if p['url']=='about:blank#kamen-standby'])==1
assert original.issubset({p['id'] for p in targets})
post('restore')
active=[]
for target in controller.targets():
    c=m.CDP(target)
    try:
        if c.evaluate("document.visibilityState === 'visible'"):active.append(target['id'])
    finally:c.close()
assert any(p in original for p in active)
print('PASS: single standby tab reused, original platform tabs retained and foreground restored')
