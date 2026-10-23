// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { it, expect, vi } from "vitest";
import { MobileViewportState } from "./mobile-viewport-state";

it("recognizes typing inside the operations iframe and clears keyboard layout after leaving", async()=>{
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT:boolean }).IS_REACT_ACT_ENVIRONMENT=true;
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
  const frame=document.createElement('iframe');frame.dataset.operationsFrame='true';document.body.append(frame);
  let height=844;
  const viewport=Object.assign(new EventTarget(),{get height(){return height},offsetTop:0,scale:1});
  Object.defineProperty(viewport,'height',{get:()=>height});
  vi.stubGlobal('visualViewport',viewport);vi.spyOn(document.documentElement,'clientHeight','get').mockReturnValue(844);
  vi.stubGlobal('requestAnimationFrame',(cb:FrameRequestCallback)=>{cb(0);return 1;});vi.stubGlobal('cancelAnimationFrame',()=>{});
  try {
    await act(async()=>root.render(<MobileViewportState/>));frame.focus();
    window.dispatchEvent(new CustomEvent('kamen:embedded-editing',{detail:{editing:true}}));
    height=480;viewport.dispatchEvent(new Event('resize'));
    expect(document.documentElement.dataset.keyboardOpen).toBe('true');
    expect(document.documentElement.style.getPropertyValue('--visible-height')).toBe('480px');
    window.dispatchEvent(new CustomEvent('kamen:embedded-editing',{detail:{editing:false}}));expect(document.documentElement.dataset.keyboardOpen).toBe('false');
  } finally {await act(async()=>root.unmount());frame.remove();host.remove();vi.unstubAllGlobals();vi.restoreAllMocks();}
});
