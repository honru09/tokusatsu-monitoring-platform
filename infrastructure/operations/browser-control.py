#!/usr/bin/env python3
"""Small authenticated control surface. CDP never leaves this container."""
import hashlib
import hmac
import json
import os
import re
import secrets
import signal
import subprocess
import threading
import time
import urllib.request
import importlib.util
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

import websocket

START_URL = os.environ.get("START_URL", "https://creator.xiaohongshu.com/")
OFFICIAL = {
    "creator.xiaohongshu.com": {"creator.xiaohongshu.com", "www.xiaohongshu.com"},
    "creator.douyin.com": {"creator.douyin.com", "www.douyin.com", "sso.douyin.com"},
}
ALLOWED = OFFICIAL.get(urlparse(START_URL).hostname, set())


def official(url):
    parsed = urlparse(url)
    return (parsed.scheme == "https" and parsed.hostname in ALLOWED
            and parsed.port in (None, 443) and not parsed.username and not parsed.password)


def run(*args):
    return subprocess.run(args, capture_output=True, text=True, timeout=5, check=False).stdout


def windows():
    ids = re.findall(r"0x[0-9a-fA-F]+", run("xprop", "-root", "_NET_CLIENT_LIST"))
    return [wid for wid in ids if "chromium" in run("xprop", "-id", wid, "WM_CLASS").lower()]


def minimized(wid):
    return "Iconic" in run("xprop", "-id", wid, "WM_STATE")


class CDP:
    def __init__(self, target):
        address = target["webSocketDebuggerUrl"]
        parsed = urlparse(address)
        if parsed.hostname not in {"127.0.0.1", "localhost"} or parsed.port != 9222:
            raise ValueError("Invalid debugger address")
        self.ws = websocket.create_connection(address, timeout=5, suppress_origin=True)
        self.counter = 0

    def call(self, method, params=None):
        self.counter += 1
        self.ws.send(json.dumps({"id": self.counter, "method": method, "params": params or {}}))
        for _ in range(100):
            reply = json.loads(self.ws.recv())
            if reply.get("id") == self.counter:
                if "error" in reply:
                    raise ValueError("Browser command unavailable")
                return reply.get("result", {})
        raise ValueError("Browser response timeout")

    def evaluate(self, expression):
        reply = self.call("Runtime.evaluate", {"expression": expression, "returnByValue": True})
        if "exceptionDetails" in reply:
            raise ValueError("Page changed; scan again")
        return reply.get("result", {}).get("value")

    def close(self):
        self.ws.close()


class BrowserControl:
    def __init__(self):
        self.lock = threading.RLock()
        self.process = None
        self.scans = {}
        self.page_scans = {}
        self.location_pages = set()
        self.resume_target = None

    def targets(self):
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open("http://127.0.0.1:9222/json/list", timeout=3) as response:
            return [p for p in json.load(response) if p.get("type") == "page"]

    def restore(self, home=False):
        with self.lock:
            ids = windows()
            if not ids:
                # Chromium handles its own single-instance lock. Never delete profile locks.
                if self.process is None or self.process.poll() is not None:
                    self.process = subprocess.Popen([
                        "chromium", "--user-data-dir=/profile/chromium", "--no-first-run",
                        "--lang=zh-CN", "--accept-lang=zh-CN,zh,en-US,en",
                        "--no-default-browser-check", "--disable-dev-shm-usage",
                        "--disable-features=Translate", "--proxy-server=http://ops-egress:3128",
                        "--force-prefers-reduced-motion",
                        # Xvfb has no hardware GPU; avoid a busy software GPU process.
                        *(["--disable-gpu"] if os.environ.get("OPS_DISABLE_GPU", "true") == "true" else []),
                        "--proxy-bypass-list=<-loopback>", "--start-maximized", "--password-store=basic",
                        "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=9222", "--restore-last-session",
                        *([] if any(Path('/profile/chromium').glob('*/Sessions/Session_*')) else [START_URL]),
                    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                for _ in range(40):
                    ids = windows()
                    if ids:
                        break
                    time.sleep(0.15)
            for wid in ids:
                run("wmctrl", "-ia", wid)
                run("wmctrl", "-ir", wid, "-b", "add,maximized_vert,maximized_horz")
            if not ids:
                raise ValueError("Browser is starting; retry shortly")
            try:
                pages = self.targets()
                standby = next((p for p in pages if p.get("url") == "about:blank#kamen-standby"), None)
                if standby:
                    selected = next((p for p in pages if p["id"] == self.resume_target), None) or next((p for p in pages if official(p.get("url", ""))), None)
                    if selected:
                        cdp = CDP(selected)
                        try:
                            cdp.call("Target.activateTarget", {"targetId": selected["id"]})
                        finally:
                            cdp.close()
            except (ValueError, OSError):
                pass
            if home:
                pages = self.targets()
                if pages:
                    cdp = CDP(pages[0])
                    try:
                        cdp.call("Page.navigate", {"url": START_URL})
                    finally:
                        cdp.close()
            return {"ok": True, "restored": True}

    def park(self):
        with self.lock:
            pages = self.targets()
            standby = next((p for p in pages if p.get("url") == "about:blank#kamen-standby"), None)
            for page in pages:
                if page == standby:
                    continue
                cdp = CDP(page)
                try:
                    if cdp.evaluate("document.visibilityState === 'visible'"):
                        self.resume_target = page["id"]
                finally:
                    cdp.close()
            target = pages[0] if pages else None
            if not target:
                return {"ok": True}
            cdp = CDP(target)
            try:
                target_id = standby["id"] if standby else cdp.call("Target.createTarget", {"url": "about:blank#kamen-standby", "background": False})["targetId"]
                cdp.call("Target.activateTarget", {"targetId": target_id})
            finally:
                cdp.close()
            return {"ok": True, "parked": True}

    def watchdog(self, stop):
        while not stop.wait(3):
            try:
                with self.lock:
                    ids = windows()
                    # A browser can take several seconds to create its first
                    # X window after Xvfb starts. Keep the control server alive
                    # and let this loop retry instead of terminating the
                    # container from serve().
                    if not ids or all(minimized(wid) for wid in ids):
                        self.restore()
            except (OSError, ValueError, subprocess.TimeoutExpired):
                pass

    def scan(self):
        with self.lock:
            self.restore()
            target = next((p for p in self.targets() if official(p.get("url", ""))), None)
            if not target:
                return {"fields": [], "qr": None, "reason": "请先进入平台官方登录页"}
            cdp = CDP(target)
            nonce = secrets.token_urlsafe(18)
            try:
                expression = """(() => {
                  const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>8&&r.height>8&&r.bottom>0&&r.right>0&&r.top<innerHeight&&s.visibility==='visible'&&s.display!=='none'};
                  const describe=e=>[e.type,e.name,e.id,e.autocomplete,e.placeholder,e.getAttribute('aria-label')].filter(Boolean).join(' ');
                  const fields=[]; const nonce=NONCE;
                  for(const e of document.querySelectorAll('input')) {
                    if(!visible(e)||e.disabled||e.readOnly)continue;
                    const hint=describe(e); let kind=null;
                    if(e.type==='password')kind='password';
                    else if(/验证码|校验码|verification|one-time-code|\\botp\\b|captcha/i.test(hint))kind='code';
                    else if(/手机|电话|账号|邮箱|phone|mobile|email|username|account/i.test(hint)||['tel','email'].includes(e.type))kind='account';
                    if(!kind)continue;
                    const id=nonce+'-'+fields.length;e.setAttribute('data-kamen-login-field',id);
                    fields.push({id,kind,label:kind==='password'?'密码':kind==='code'?'验证码':'账号 / 手机号',type:e.type});
                  }
                  const buttons=[...document.querySelectorAll('button,[role=button],input[type=submit]')].filter(e=>visible(e)&&!e.disabled&&/^(登录|登\\s*录|立即登录|确认登录|登入|Sign in|Log in)$/i.test((e.innerText||e.value||'').trim()));
                  let submit=null;
                  if(buttons.length===1){submit=nonce+'-submit';buttons[0].setAttribute('data-kamen-login-field',submit)}
                  const qr=[...document.querySelectorAll('img,canvas,svg')].find(e=>{
                    if(!visible(e))return false;const r=e.getBoundingClientRect();
                    return r.width>=90&&r.height>=90&&r.width<=500&&r.height<=500&&Math.abs(r.width-r.height)<40&&/qrcode|qr-code|qr_code|二维码/i.test([e.id,e.getAttribute('class'),e.getAttribute('alt'),e.parentElement?.getAttribute('class')].join(' '));
                  });
                  let clip=null;if(qr){const r=qr.getBoundingClientRect();clip={x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height,scale:1}};
                  return {url:location.href,fields,submit,clip};
                })()""".replace("NONCE", json.dumps(nonce))
                data = cdp.evaluate(expression)
                if not data or not official(data.get("url", "")) or data["url"] != target["url"]:
                    raise ValueError("Page changed; scan again")
                qr = None
                if data.get("clip"):
                    qr = cdp.call("Page.captureScreenshot", {"format": "png", "clip": data["clip"], "captureBeyondViewport": False}).get("data")
                self.scans = {k: s for k, s in self.scans.items() if s["expires"] > time.time()}
                if len(self.scans) >= 8:
                    self.scans.pop(next(iter(self.scans)))
                self.scans[nonce] = {"target": target["id"], "url": data["url"], "fields": data["fields"], "submit": data["submit"], "expires": time.time()+180}
                return {"scanId": nonce, "fields": [{k: f[k] for k in ("id", "kind", "label")} for f in data["fields"]], "canSubmit": bool(data["submit"]), "qr": qr, "host": urlparse(data["url"]).hostname}
            finally:
                cdp.close()

    def page_action(self, action, payload):
        with self.lock:
            expression = Path(__file__).with_name("page-assistant.js").read_text()
            def evaluate(cdp, args):
                return cdp.evaluate(expression.replace("__KAMEN_ARGS__", json.dumps(args, ensure_ascii=False)))
            if action == "page-import":
                title, body = payload.get("title"), payload.get("body")
                if not isinstance(title,str) or not isinstance(body,str) or len(title)>20000 or len(body)>20000:
                    return {"ok":False,"code":"invalid_draft"}
                if not title.strip():
                    return {"ok":False,"code":"empty_title"}
                detected=self.page_action("page-scan",{"editorOnly":True})
                titles=[f for f in detected.get("fields",[]) if f["kind"]=="title"]
                bodies=[f for f in detected.get("fields",[]) if f["kind"]=="body"]
                if len(titles)!=1 or len(bodies)!=1:
                    return {"ok":False,"code":"editor_not_ready"}
                if len(title)>titles[0]["maxLength"] or len(body)>bodies[0]["maxLength"]:
                    return {"ok":False,"code":"draft_too_long"}
                return self.page_action("page-fill",{"scanId":detected["scanId"],"values":{titles[0]["id"]:title,bodies[0]["id"]:body}})
            if action == "page-scan":
                targets = [p for p in self.targets() if official(p.get("url", ""))]
                if payload.get("editorOnly"):
                    candidates=[]
                    for candidate in targets:
                        c=CDP(candidate)
                        try:
                            inspected=evaluate(c,{"mode":"scan","nonce":secrets.token_urlsafe(18),"locationOpen":False})
                            kinds=[f["kind"] for f in inspected.get("fields",[])]
                            if kinds.count("title")==1 and kinds.count("body")==1:
                                candidates.append((candidate,c.evaluate("document.visibilityState === 'visible'")))
                        finally:c.close()
                    visible=[p for p,shown in candidates if shown]
                    selected=visible if len(visible)==1 else [p for p,_ in candidates]
                    if len(selected)!=1:return {"fields":[],"actions":[],"choices":[],"reason":"editor_not_ready"}
                    targets=selected
                target = None
                for candidate in targets:
                    c = CDP(candidate)
                    try:
                        if c.evaluate("document.hasFocus()"):
                            target = candidate
                            break
                    finally:
                        c.close()
                target = target or next(iter(targets), None)
                if not target:
                    return {"fields": [], "actions": [], "choices": [], "reason": "请先进入平台官方编辑页"}
                cdp = CDP(target)
                try:
                    nonce = secrets.token_urlsafe(18)
                    result = evaluate(cdp, {"mode": "scan", "nonce": nonce, "locationOpen": target["id"] in self.location_pages})
                    if not result or result["url"] != target["url"] or not official(result["url"]):
                        raise ValueError("Page changed")
                    self.page_scans = {k: s for k, s in self.page_scans.items() if s["expires"] > time.time()}
                    if len(self.page_scans) >= 8:
                        self.page_scans.pop(next(iter(self.page_scans)))
                    self.page_scans[nonce] = {**result, "target": target["id"], "expires": time.time()+600}
                    return {"scanId": nonce, "fields": [{k: f[k] for k in ("id", "kind", "label", "maxLength", "value")} for f in result["fields"]], "actions": result["actions"], "choices": result["choices"]}
                finally:
                    cdp.close()
            scan = self.page_scans.get(payload.get("scanId", ""))
            if not scan or scan["expires"] < time.time():
                raise ValueError("Page scan expired")
            target = next((p for p in self.targets() if p["id"] == scan["target"] and p["url"] == scan["url"] and official(p["url"])), None)
            if not target:
                raise ValueError("Page changed")
            cdp = CDP(target)
            try:
                if action == "page-fill":
                    values = payload.get("values", {})
                    allowed = {f["id"]: f for f in scan["fields"]}
                    if not isinstance(values, dict) or len(values) > 16:
                        raise ValueError("Invalid fields")
                    fields = []
                    for key, value in values.items():
                        if key not in allowed or not isinstance(value, str) or len(value) > allowed[key]["maxLength"]:
                            raise ValueError("Invalid field")
                        fields.append({**allowed[key], "value": value})
                    cdp.call("Target.activateTarget", {"targetId": target["id"]})
                    cdp.call("Page.bringToFront")
                    evaluate(cdp, {"mode": "prepare", "url": scan["url"], "fields": fields})
                    for field in fields:
                        focused=evaluate(cdp, {"mode": "focus-field", "url": scan["url"], "field": field})
                        if not focused or not focused.get("ok"):raise ValueError("Could not focus editor field")
                        if field["value"]:
                            cdp.call("Input.insertText", {"text": field["value"]})
                        else:
                            cdp.call("Input.dispatchKeyEvent", {"type": "keyDown", "key": "Backspace", "code": "Backspace", "windowsVirtualKeyCode": 8})
                            cdp.call("Input.dispatchKeyEvent", {"type": "keyUp", "key": "Backspace", "code": "Backspace", "windowsVirtualKeyCode": 8})
                    # Framework-controlled inputs may revert a synthetic input event.
                    # Verify the visible editor values after its state settles.
                    time.sleep(0.15)
                    verification = evaluate(cdp, {"mode": "verify", "url": scan["url"], "fields": fields})
                    if not verification or not verification.get("ok"):
                        return {"ok": False, "count": verification.get("count", 0) if verification else 0, "verified": False}
                    return {"ok": True, "count": verification["count"], "verified": True}
                mode = "location" if action == "page-location" else "choice"
                choices = scan["actions"] if mode == "location" else scan["choices"]
                selected = next((x for x in choices if x["id"] == payload.get("actionId")), None)
                if not selected:
                    raise ValueError("Unknown location action")
                result = evaluate(cdp, {"mode": mode, "url": scan["url"], "action": selected})
                if mode == "location":
                    self.location_pages.add(target["id"])
                return result
            finally:
                cdp.close()

    def media_action(self, action, payload):
        with self.lock:
            if not hasattr(self, 'media_bridge'):
                spec = importlib.util.spec_from_file_location('media_bridge', Path(__file__).with_name('media-bridge.py'))
                bridge = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(bridge)
                self.media_bridge = bridge.MediaBridge(CDP, official, self.targets)
            return self.media_bridge.scan() if action == 'media-scan' else self.media_bridge.attach(payload)

    def view_action(self, payload):
        with self.lock:
            command=payload.get('command')
            if command not in {'up','down','top','bottom','zoom-in','zoom-out','zoom-reset'}:raise ValueError('Invalid view command')
            targets=[t for t in self.targets() if official(t.get('url',''))]
            active=[]
            for target in targets:
                c=CDP(target)
                try:
                    if c.evaluate("document.visibilityState==='visible'"):active.append(target)
                finally:c.close()
            candidates=active or targets
            if len(candidates)!=1:raise ValueError('Select a platform page')
            c=CDP(candidates[0])
            try:
                script="""(() => {const command=COMMAND;
                  if(command.startsWith('zoom-')){let current=Number(document.documentElement.dataset.kamenZoom||1);if(!Number.isFinite(current))current=1;const next=command==='zoom-reset'?1:Math.min(1.75,Math.max(.6,Math.round((current+(command==='zoom-in'?.15:-.15))*100)/100));document.documentElement.dataset.kamenZoom=String(next);document.documentElement.style.zoom=String(next);return {ok:true,zoom:next};}
                  const candidates=[document.scrollingElement,...document.querySelectorAll('main,[role=main],section,div')].filter(e=>{if(!e||e.closest('[contenteditable=true],textarea'))return false;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>160&&r.height>100&&r.top<innerHeight&&r.bottom>0&&e.scrollHeight>e.clientHeight+20&&(e===document.scrollingElement||/auto|scroll/.test(s.overflowY));});
                  candidates.sort((a,b)=>{const x=a.getBoundingClientRect(),y=b.getBoundingClientRect();return Math.min(y.width,innerWidth)*Math.min(y.height,innerHeight)-Math.min(x.width,innerWidth)*Math.min(x.height,innerHeight)});
                  const e=candidates[0]||document.scrollingElement;if(!e)return {ok:true};const delta=Math.max(100,e.clientHeight*.72);e.scrollTo({top:command==='top'?0:command==='bottom'?e.scrollHeight:e.scrollTop+(command==='up'?-delta:delta),behavior:'instant'});return {ok:true};
                })()""".replace('COMMAND',json.dumps(command))
                return c.evaluate(script)
            finally:c.close()

    def login_action(self, action, payload):
        with self.lock:
            scan = self.scans.get(payload.get("scanId", ""))
            if not scan or scan["expires"] < time.time():
                raise ValueError("登录页已变化，请重新识别")
            target = next((p for p in self.targets() if p["id"] == scan["target"] and p["url"] == scan["url"] and official(p["url"])), None)
            if not target:
                raise ValueError("登录页已变化，请重新识别")
            cdp = CDP(target)
            try:
                if action == "login-fill":
                    values = payload.get("values", {})
                    if not isinstance(values, dict) or len(values) > 12:
                        raise ValueError("Invalid fields")
                    allowed = {f["id"]: f for f in scan["fields"]}
                    entries = []
                    for key, value in values.items():
                        if key not in allowed or not isinstance(value, str) or len(value) > 256:
                            raise ValueError("Invalid field")
                        entries.append({"id": key, "value": value, "type": allowed[key]["type"]})
                    code = """(() => {if(location.href!==URL)throw Error('changed');const entries=ENTRIES;
                      const found=entries.map(f=>{const e=document.querySelector('[data-kamen-login-field="'+f.id+'"]');if(!e||e.type!==f.type||e.disabled||e.readOnly||!e.checkVisibility())throw Error('changed');return [e,f.value]});
                      for(const [e,v] of found){Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,v);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))}return {ok:true};})()""".replace("URL", json.dumps(scan["url"])).replace("ENTRIES", json.dumps(entries))
                else:
                    if not scan["submit"]:
                        raise ValueError("请在控制台点击登录")
                    code = """(() => {if(location.href!==URL)throw Error('changed');const e=document.querySelector('[data-kamen-login-field="'+ID+'"]');if(!e||e.disabled||!e.checkVisibility()||!/^(登录|登\\s*录|立即登录|确认登录|登入|Sign in|Log in)$/i.test((e.innerText||e.value||'').trim()))throw Error('changed');e.click();return {ok:true}})()""".replace("URL", json.dumps(scan["url"])).replace("ID", json.dumps(scan["submit"]))
                result = cdp.evaluate(code)
                if action == "login-submit":
                    del self.scans[payload["scanId"]]
                return result
            finally:
                cdp.close()


def serve():
    token = Path(os.environ.get("OPS_CONTROL_TOKEN_FILE", "/control/token")).read_text().strip()
    if len(token) < 32:
        raise ValueError("Control token required")
    controller = BrowserControl()
    stop = threading.Event()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_POST(self):
            valid = hmac.compare_digest(hashlib.sha256(self.headers.get("Authorization", "").encode()).digest(), hashlib.sha256(("Bearer "+token).encode()).digest())
            status, result = 403, {"error": "Unauthorized"}
            if valid:
                try:
                    length = int(self.headers.get("Content-Length", "0"))
                    if not 0 <= length <= 100_000:
                        raise ValueError("Invalid request")
                    payload = json.loads(self.rfile.read(length) or b"{}")
                    action = self.path.removeprefix("/")
                    if action == "restore":
                        result = controller.restore()
                    elif action == "park":
                        result = controller.park()
                    elif action == "home":
                        result = controller.restore(home=True)
                    elif action == "login-scan":
                        result = controller.scan()
                    elif action in {"login-fill", "login-submit"}:
                        result = controller.login_action(action, payload)
                    elif action in {"page-scan", "page-fill", "page-import", "page-location", "page-choice"}:
                        result = controller.page_action(action, payload)
                    elif action in {"media-scan", "media-attach"}:
                        result = controller.media_action(action, payload)
                    elif action == "page-view":
                        result = controller.view_action(payload)
                    else:
                        raise ValueError("Unsupported action")
                    status = 200
                except Exception:
                    status, result = 409, {"error": "浏览器页面已变化或尚未就绪，请重新连接并识别"}
            encoded = json.dumps(result, ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)

    server = ThreadingHTTPServer(("0.0.0.0", 5901), Handler)
    def shutdown(*_):
        stop.set()
        threading.Thread(target=server.shutdown, daemon=True).start()
    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)

    def start_browser():
        try:
            controller.restore()
        except (OSError, ValueError, subprocess.TimeoutExpired):
            # BrowserControl.watchdog retries while Chromium/Xvfb finishes
            # starting. The authenticated HTTP control endpoint stays alive.
            pass

    threading.Thread(target=controller.watchdog, args=(stop,), daemon=True).start()
    threading.Thread(target=start_browser, daemon=True).start()
    try:
        server.serve_forever()
    finally:
        stop.set()
        server.server_close()
        if controller.process and controller.process.poll() is None:
            controller.process.terminate()
            try:
                controller.process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                pass


if __name__ == "__main__":
    serve()
