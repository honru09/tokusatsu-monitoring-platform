"""Verify readonly enforcement without entering text or clicking platform actions."""
import ctypes
import socket
import struct
import time

def exact(sock,n):
    data=b""
    while len(data)<n:
        part=sock.recv(n-len(data))
        if not part: raise AssertionError("VNC handshake ended")
        data+=part
    return data

def connect(port):
    sock=socket.create_connection(("127.0.0.1",port),timeout=5)
    assert exact(sock,12).startswith(b"RFB ")
    sock.sendall(b"RFB 003.008\n")
    count=exact(sock,1)[0]
    types=exact(sock,count)
    assert 1 in types
    sock.sendall(b"\x01")
    assert exact(sock,4)==b"\x00"*4
    sock.sendall(b"\x01")
    init=exact(sock,24)
    exact(sock,struct.unpack(">I",init[20:24])[0])
    return sock

x=ctypes.CDLL("libX11.so.6")
x.XOpenDisplay.restype=ctypes.c_void_p
x.XDefaultRootWindow.argtypes=[ctypes.c_void_p]
x.XDefaultRootWindow.restype=ctypes.c_ulong
x.XQueryPointer.argtypes=[ctypes.c_void_p,ctypes.c_ulong,ctypes.POINTER(ctypes.c_ulong),ctypes.POINTER(ctypes.c_ulong),ctypes.POINTER(ctypes.c_int),ctypes.POINTER(ctypes.c_int),ctypes.POINTER(ctypes.c_int),ctypes.POINTER(ctypes.c_int),ctypes.POINTER(ctypes.c_uint)]
x.XCloseDisplay.argtypes=[ctypes.c_void_p]
display=x.XOpenDisplay(b":99")
assert display
def position():
    root,child=ctypes.c_ulong(),ctypes.c_ulong()
    rx,ry,wx,wy=ctypes.c_int(),ctypes.c_int(),ctypes.c_int(),ctypes.c_int()
    mask=ctypes.c_uint()
    assert x.XQueryPointer(display,x.XDefaultRootWindow(display),ctypes.byref(root),ctypes.byref(child),ctypes.byref(rx),ctypes.byref(ry),ctypes.byref(wx),ctypes.byref(wy),ctypes.byref(mask))
    return rx.value,ry.value
def move(sock,pos):
    sock.sendall(struct.pack(">BBHH",5,0,*pos));time.sleep(0.25)

operator=connect(5900);observer=connect(5902);original=position()
try:
    move(operator,(101,101));assert position()==(101,101),"Operator input not delivered"
    move(observer,(401,401));assert position()==(101,101),"Observer can move cursor"
    print("PASS: simultaneous operator and observer; forged observer pointer ignored server-side")
finally:
    move(operator,original);operator.close();observer.close();x.XCloseDisplay(display)
