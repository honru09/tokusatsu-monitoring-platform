"""Read-only workload sample. Reports counts and durations, never page content."""
import importlib.util
import json
import time
spec=importlib.util.spec_from_file_location("control","/usr/local/bin/browser-control.py")
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
controller=m.BrowserControl();pages=controller.targets();results=[]
for page in pages:
    c=m.CDP(page)
    try:
        c.call("Performance.enable")
        a={v['name']:v['value'] for v in c.call('Performance.getMetrics').get('metrics',[])}
        info=c.evaluate("({animations:document.getAnimations().filter(a=>a.playState==='running').length,videos:[...document.querySelectorAll('video')].filter(v=>!v.paused).length,canvases:document.querySelectorAll('canvas').length,reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches})")
        time.sleep(3)
        b={v['name']:v['value'] for v in c.call('Performance.getMetrics').get('metrics',[])}
        results.append({**info,**{k:round(b.get(k,0)-a.get(k,0),4) for k in ['TaskDuration','ScriptDuration','LayoutDuration']}})
    finally:c.close()
print(json.dumps(results))
