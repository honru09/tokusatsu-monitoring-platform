"""Run inside a browser container; does not print page data or credentials."""
import ctypes
import importlib.util
import json
import time
import urllib.request
from pathlib import Path

spec = importlib.util.spec_from_file_location("control", "/usr/local/bin/browser-control.py")
control = importlib.util.module_from_spec(spec)
spec.loader.exec_module(control)
browser = control.BrowserControl()
wid = control.windows()[0]
x = ctypes.CDLL("libX11.so.6")
x.XOpenDisplay.restype = ctypes.c_void_p
x.XIconifyWindow.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_int]
x.XFlush.argtypes = [ctypes.c_void_p]
x.XCloseDisplay.argtypes = [ctypes.c_void_p]
display = x.XOpenDisplay(b":99")
assert display
def minimize():
    x.XIconifyWindow(display, int(wid, 16), 0)
    x.XFlush(display)
    time.sleep(0.1)
    assert control.minimized(wid), "Did not reproduce minimized window"

def post(action, authorized=True):
    headers = {"Content-Type": "application/json"}
    if authorized:
        headers["Authorization"] = "Bearer " + Path("/control/token").read_text().strip()
    req = urllib.request.Request("http://127.0.0.1:5901/"+action, data=b"{}", headers=headers)
    with urllib.request.urlopen(req, timeout=20) as response:
        return json.load(response)

try:
    minimize()
    assert post("restore")["restored"]
    assert not control.minimized(wid), "Reconnect restore failed"
    print("PASS: minimized -> authenticated restore -> normal, same browser window")
    minimize()
    deadline = time.monotonic()+7
    while control.minimized(wid) and time.monotonic() < deadline:
        time.sleep(0.2)
    assert not control.minimized(wid), "Watchdog did not restore minimized window"
    print("PASS: minimized -> automatic watchdog restore without reconnect")
    try:
        post("restore", False)
        raise AssertionError("Unauthenticated control accepted")
    except urllib.error.HTTPError as error:
        assert error.code == 403
    print("PASS: anonymous control rejected")
    result = post("login-scan")
    print(json.dumps({"loginScan": "ok", "fieldCount": len(result.get("fields", [])), "qrDetected": bool(result.get("qr"))}))
finally:
    x.XCloseDisplay(display)
