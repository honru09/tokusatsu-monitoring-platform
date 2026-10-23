// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, it, expect, vi } from "vitest";
import { OperationsWorkspace } from "./operations-workspace";

describe("operations workspace persistence", () => {
  it("loads only when opened, retains iframe across chat roundtrip and reconnects without reload", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT:boolean }).IS_REACT_ACT_ENVIRONMENT=true;
    vi.stubGlobal('React', React);
    const host=document.createElement('div');document.body.append(host);const root=createRoot(host);const open=vi.fn();
    try {
      await act(async()=>root.render(<OperationsWorkspace active={false} onOpenChat={open}/>));expect(host.querySelector('iframe')).toBeNull();
      await act(async()=>root.render(<OperationsWorkspace active onOpenChat={open}/>));const frame=host.querySelector('iframe')!;
      const post=vi.spyOn(frame.contentWindow!,'postMessage');
      await act(async()=>root.render(<OperationsWorkspace active={false} onOpenChat={open}/>));expect(host.querySelector('iframe')).toBe(frame);expect(host.querySelector('section')?.hidden).toBe(true);
      await act(async()=>root.render(<OperationsWorkspace active onOpenChat={open}/>));expect(host.querySelector('iframe')).toBe(frame);
      await act(async()=>host.querySelector('button')?.click());expect(host.querySelector('iframe')).toBe(frame);expect(post).toHaveBeenCalledWith({type:'kamen-operations:reconnect'},location.origin);
      await act(async()=>window.dispatchEvent(new MessageEvent('message',{origin:location.origin,source:frame.contentWindow,data:{type:'kamen-operations:navigate',workspace:'collaboration'}})));expect(open).toHaveBeenCalledOnce();
      await act(async()=>window.dispatchEvent(new MessageEvent('message',{origin:'https://untrusted.invalid',source:frame.contentWindow,data:{type:'kamen-operations:navigate',workspace:'collaboration'}})));expect(open).toHaveBeenCalledOnce();
      await act(async()=>window.dispatchEvent(new MessageEvent('message',{origin:location.origin,source:frame.contentWindow,data:{type:'kamen-operations:expand'}})));
      expect(document.documentElement.dataset.operationsExpanded).toBe('true');
      await act(async()=>root.render(<OperationsWorkspace active={false} onOpenChat={open}/>));expect(document.documentElement.dataset.operationsExpanded).toBe('false');expect(host.querySelector('iframe')).toBe(frame);
    } finally {await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();}
  });
});
