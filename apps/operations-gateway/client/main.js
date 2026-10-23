import RFB from "@novnc/novnc";
import { splitPublishingText } from "./editor-draft.mjs";
import { mountMediaLibrary } from './media-library.mjs';
const $ = (id) => document.getElementById(id);
const api = "./api/";
const clientId = crypto.randomUUID();
document.body.dataset.embedded = String(window.parent !== window);
let role = "observer", eventSocket = null, wantConnected = false, parentActive = true;
let connecting = false, connectGeneration = 0, retryTimer = 0, retryCount = 0;
let eventRetryTimer = 0, frameReady = 0, presenceTimer = 0;
let zoomed = false, panMode = true;
let editorScan = null, editorBusy = false;
let mediaLibrary=null;
let pageViewBusy=false;
let panelReturnFocus=null;
let splitDraftPending = false;
let editorEpoch = 0;
const editorDrafts = new Map();
const currentEditorValues = () => new Map([...$("editor-fields").querySelectorAll("input,textarea")].filter(e=>e.dataset.dirty==='true').map(e=>[e.dataset.draftKey,{value:e.value,manual:e.dataset.manual==='true'}]));
const quality = () => ({smooth:4,sharp:8,low:2})[$("picture-quality").value] ?? 4;
const isActive = () => parentActive && !document.hidden;
let csrf = "",
  rfb = null,
  platform = "xiaohongshu",
  connected = false,
  uploading = false,
  status = null;
const labels = { xiaohongshu: "小红书", douyin: "抖音" };
async function request(path, options = {}) {
  const response = await fetch(api + path, {
    cache: "no-store",
    ...options,
    headers: {
      ...(options.body && typeof options.body === "string"
        ? { "content-type": "application/json" }
        : {}),
      "x-csrf-token": csrf,
      "x-operations-client": clientId,
      ...options.headers,
    },
  });
  const data = await response.json();
  if (response.status === 401) {
    disconnect();
    eventSocket?.close();
    $("workspace").hidden = true;
    $("login-view").hidden = false;
  }
  if (!response.ok) throw Object.assign(new Error(data.error ?? "连接失败，请重试"),{status:response.status});
  return data;
}
function setConnection(message, live = false) {
  connected = live;
  $("connection-status").textContent = message;
  $("connection-dot").dataset.connected = String(live);
  $("disconnect").disabled = !rfb;
  $("paste").disabled = !live || role !== "operator" || editorBusy;
  $("type-text").disabled = !live || role !== "operator" || editorBusy;
  if(rfb)rfb.viewOnly=role!=="operator"||editorBusy;
  $("restore-window").disabled = role !== "operator";
  $("files").disabled = role !== "operator";
  $("zoom-toggle").disabled = !live;
  $("pan-toggle").disabled = !live;
  for(const id of ["quick-input","quick-tab","quick-enter","quick-backspace","editor-open"])$(id).disabled=!live||role!=="operator"||editorBusy;
  $("editor-scan").disabled=editorBusy||role!=="operator";
  $("editor-apply").disabled=editorBusy||role!=="operator"||!editorScan?.fields?.length;
  $("editor-import").disabled=editorBusy||role!=="operator";
  $("connect").hidden = live;
  $("start-control").disabled = connecting;
  mediaLibrary?.updateControls();
  for(const button of document.querySelectorAll('[data-page-command]'))button.disabled=!live||role!=='operator'||editorBusy||pageViewBusy;
}
function updateViewport() {
  if(rfb) {
    rfb.clipViewport = true;
    rfb.scaleViewport = !zoomed;
    rfb.dragViewport = zoomed && (panMode || role !== "operator");
  }
  $("zoom-toggle").setAttribute("aria-pressed",String(zoomed));
  $("zoom-toggle").textContent=zoomed?"适应":"放大";
  $("pan-toggle").hidden=!zoomed;
  $("pan-toggle").setAttribute("aria-pressed",String(panMode||role!=="operator"));
  $("pan-toggle").textContent=panMode||role!=="operator"?"拖动":"点击";
  $("pan-toggle").title=panMode?"当前拖动画面，点此切换点击操作":"当前点击操作，点此切换拖动画面";
}
function keepPreview() {
  const canvas = $("screen").querySelector("canvas"), preview = $("screen-preview");
  if (!canvas?.width || !canvas.height) return;
  preview.width = canvas.width; preview.height = canvas.height;
  preview.getContext("2d").drawImage(canvas, 0, 0);
  preview.hidden = false;
}
function disconnect(preserve = false) {
  if (preserve) keepPreview();
  else { wantConnected = false; $("screen-preview").hidden = true; }
  clearTimeout(retryTimer); cancelAnimationFrame(frameReady);
  connecting = false; connectGeneration++;
  const current = rfb;
  rfb = null;
  current?.disconnect();
  $("screen").replaceChildren();
  $("screen-empty").hidden = preserve;
  setConnection("未连接");
}
function renderStatus(data) {
  const changed = role !== data.role;
  role = data.role ?? "observer";
  updateViewport();
  if (status) status = { ...status, ...data };
  $("role-operator").setAttribute("aria-pressed", String(role === "operator"));
  $("role-observer").setAttribute("aria-pressed", String(role === "observer"));
  $("role-operator").disabled = Boolean(data.operator && !data.operator.yours);
  $("role-operator").title = data.operator && !data.operator.yours ? `${data.operator.name}正在操作` : "取得操作权";
  const current = data.browsers?.find(b => b.id === platform);
  $("viewer-count").textContent = current ? `${current.viewers ?? 0} 人观看` : "";
  $("control-owner").textContent = data.operator ? `${data.operator.name}操作中` : "暂无操作员";
  setConnection(connected ? (role === "operator" ? "正在操作" : "正在观看") : connecting ? "连接中…" : "可连接", connected);
  if (changed && rfb) { disconnect(true); if (wantConnected && isActive()) void connect(); }
}
function sendPresence() {
  if (eventSocket?.readyState === WebSocket.OPEN) eventSocket.send(JSON.stringify({ type:"presence", active:isActive() }));
}
function connectEvents() {
  if (!csrf || $("workspace").hidden || (eventSocket && eventSocket.readyState < WebSocket.CLOSING)) return;
  clearTimeout(eventRetryTimer);
  const url = new URL(`${location.pathname}ws/events`, location.origin);
  url.protocol = location.protocol === "https:" ? "wss:" : "ws:"; url.searchParams.set("client",clientId);
  const ws = new WebSocket(url); eventSocket = ws;
  ws.addEventListener("open", sendPresence);
  ws.addEventListener("message", event => { if (eventSocket !== ws) return; try { const data=JSON.parse(event.data); if(data.type === "status")renderStatus(data); } catch {} });
  ws.addEventListener("close",()=>{ if(eventSocket !== ws)return; eventSocket=null; if(csrf && !$("workspace").hidden)eventRetryTimer=setTimeout(connectEvents,3000); });
}
async function refreshStatus() {
  try {
    status = await request("status");
    csrf = status.csrf;
    $("operator-name").textContent = status.name;
    $("login-view").hidden = true;
    $("workspace").hidden = false;
    renderStatus(status);
    connectEvents();
  } catch (error) {
    if (!$("workspace").hidden) setConnection(error.message);
  }
}
async function connect() {
  wantConnected = true;
  if (rfb || connecting || !isActive()) return;
  connecting = true;
  const generation = ++connectGeneration;
  await refreshStatus();
  if ($("workspace").hidden || generation !== connectGeneration || !isActive()) { connecting=false; return; }
  $("start-control").disabled = true;
  setConnection("正在连接…");
  try {
    const url = new URL(`${location.pathname}ws/${platform}`, location.origin);
    url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("client", clientId);
    const instance = new RFB($("screen"), url.href, { shared: true });
    rfb = instance;
    instance.viewOnly = role !== "operator";
    updateViewport();
    instance.resizeSession = false;
    instance.qualityLevel = quality();
    instance.compressionLevel = 1;
    instance.addEventListener("connect", () => {
      if (rfb !== instance) return;
      connecting = false; retryCount = 0;
      $("screen-empty").hidden = true;
      setConnection(role === "operator" ? "正在操作" : "正在观看", true);
      const reveal = () => {
        if (rfb !== instance) return;
        const canvas = $("screen").querySelector("canvas");
        if (canvas?.width && canvas?.height && canvas.getContext("2d").getImageData(0,0,1,1).data[3]) $("screen-preview").hidden = true;
        else frameReady=requestAnimationFrame(reveal);
      };
      frameReady=requestAnimationFrame(reveal);
    });
    instance.addEventListener("disconnect", () => {
      if (rfb !== instance) return;
      keepPreview(); rfb = null; connecting = false;
      $("screen-empty").hidden = !$("screen-preview").hidden;
      setConnection("连接中断，正在恢复…");
      if (wantConnected && isActive() && retryCount < 6) retryTimer=setTimeout(()=>void connect(),Math.min(6000,500*2**retryCount++));
      else { $("screen-empty").hidden=false; $("empty-copy").textContent="连接已结束，点击重新连接。"; }
    });
    instance.addEventListener("securityfailure", () =>
      setConnection("连接验证失败，请重新登录运营台"),
    );
  } catch (error) {
    disconnect(true);
    setConnection(error.message);
  }
}
async function chooseRole(next) {
  try {
    const data = await request("control", {method:"POST",body:JSON.stringify({role:next})});
    renderStatus(data); sendPresence();
    if(!rfb && isActive())void connect();
  } catch(error){setConnection(error.message,connected);await refreshStatus();}
}
function changeVisibility() {
  sendPresence();
  if (!isActive()) { if (rfb || connecting)disconnect(true); }
  else { void refreshStatus(); if(wantConnected)void connect(); }
}
async function refreshFiles() {
  return mediaLibrary?.refresh();
}
function showMaterials(show, mode = "all") {
  if(show&&$('materials').hidden)panelReturnFocus=document.activeElement;
  $("materials").dataset.mode=mode;
  $("materials-title").textContent=mode==="editor"?"发布辅助":mode==="input"?"输入辅助":"素材与输入";
  $("materials").hidden = !show;
  document.body.dataset.panelOpen=String(show);
  const mobile=matchMedia('(max-width:900px)').matches;
  $('materials-scrim').hidden=!show||!mobile;
  $('materials').setAttribute('role',mobile?'dialog':'complementary');
  if(mobile&&show)$('materials').setAttribute('aria-modal','true');else $('materials').removeAttribute('aria-modal');
  $("materials-toggle").setAttribute("aria-expanded", String(show));
  if (show && mode==="all") void refreshFiles();
  if (!show && $("materials").contains(document.activeElement)) { document.activeElement.blur(); if(panelReturnFocus?.isConnected)panelReturnFocus.focus({preventScroll:true}); }
  if(show&&mobile&&mode!=='input')requestAnimationFrame(()=>$('materials-close').focus({preventScroll:true}));
}
async function scanEditor() {
  if(editorBusy||role!=="operator")return;
  const epoch=editorEpoch, selectedPlatform=platform;
  editorBusy=true;setConnection($("connection-status").textContent,connected);
  $("editor-status").textContent="识别中…";
  try {
    const result=await request(`browser/${selectedPlatform}/page-scan`,{method:"POST",body:"{}"});
    if(epoch!==editorEpoch)return;
    const previous = new Map([...(editorDrafts.get(selectedPlatform)?.fields??[]),...currentEditorValues()]);
    editorScan=result;
    $("editor-fields").replaceChildren();
    for(const [index,field] of editorScan.fields.entries()) {
      const label=document.createElement('label'),span=document.createElement('span');span.textContent=field.label;
      const input=document.createElement(field.kind==='body'?'textarea':'input');
      if(input.tagName==='TEXTAREA')input.rows=5;else input.type='text';
      input.maxLength=field.maxLength;input.dataset.editorField=field.id;input.dataset.editorKind=field.kind;
      input.dataset.draftKey=`${field.kind}:${field.label}:${index}`;
      input.value=previous.get(input.dataset.draftKey)?.value??field.value??'';
      input.dataset.dirty=String(previous.has(input.dataset.draftKey));
      input.dataset.manual=String(previous.get(input.dataset.draftKey)?.manual??false);
      input.addEventListener('input',()=>{input.dataset.dirty='true';input.dataset.manual='true';});
      label.append(span,input);$("editor-fields").append(label);
    }
    $("editor-location-actions").replaceChildren();
    for(const action of [...editorScan.actions,...editorScan.choices]) {
      const button=document.createElement('button');button.textContent=action.label;
      const mode=editorScan.actions.some(a=>a.id===action.id)?'page-location':'page-choice';
      button.addEventListener('click',async()=>{
        if(editorBusy||role!=="operator")return;editorBusy=true;button.disabled=true;
        try {await request(`browser/${selectedPlatform}/${mode}`,{method:'POST',body:JSON.stringify({scanId:editorScan.scanId,actionId:action.id})});if(epoch===editorEpoch)$("editor-status").textContent=mode==='page-location'?'地点已展开，识别后可填写':'已选择地点';}
        catch(error){if(epoch===editorEpoch)$("editor-status").textContent=error.message;}
        finally{if(epoch===editorEpoch){editorBusy=false;button.disabled=false;setConnection($("connection-status").textContent,connected);}}
      });
      $("editor-location-actions").append(button);
    }
    $("editor-status").textContent=editorScan.fields.length?'仅填写，不会自动发布':editorScan.reason??'未识别到编辑项，请打开标题或正文编辑页';
    if(splitDraftPending)applySplitDraft();
  }catch(error){if(epoch===editorEpoch)$("editor-status").textContent=error.message;}
  finally{if(epoch===editorEpoch){editorBusy=false;setConnection($("connection-status").textContent,connected);}}
}
function applySplitDraft(force = false) {
  const draft=splitPublishingText($("editor-source").value);
  const title=$("editor-fields").querySelector('[data-editor-kind="title"]');
  const body=$("editor-fields").querySelector('[data-editor-kind="body"]');
  for(const [element,value] of [[title,draft.title],[body,draft.body]])if(element&&(force||element.dataset.manual!=='true')){element.value=value;element.dataset.dirty='true';element.dataset.manual='false';}
  splitDraftPending=!title||!body;
  const tooLong=[title,body].find(e=>e&&e.value.length>e.maxLength);
  $("editor-status").textContent=tooLong?'文案超过平台字段字数限制，请修改后确认':splitDraftPending?'文案已保留，识别编辑页后会拆分填入':'已拆分标题和正文，确认后填入';
}
async function fillEditor() {
  if(editorBusy||!editorScan?.scanId||role!=="operator")return;
  const epoch=editorEpoch,selectedPlatform=platform;
  const values=Object.fromEntries([...$("editor-fields").querySelectorAll('input,textarea')].filter(e=>e.dataset.dirty==='true').map(e=>[e.dataset.editorField,e.value]));
  if([...$("editor-fields").querySelectorAll('input,textarea')].some(e=>e.value.length>e.maxLength)){$("editor-status").textContent='文案超过平台字段字数限制，请修改后确认';return;}
  if(!Object.keys(values).length){$("editor-status").textContent='没有待填入的修改';return;}
  editorBusy=true;setConnection($("connection-status").textContent,connected);
  try {
    const result=await request(`browser/${selectedPlatform}/page-fill`,{method:'POST',body:JSON.stringify({scanId:editorScan.scanId,values})});
    if(epoch!==editorEpoch)return;
    $("editor-status").textContent=`已填入 ${result.count} 项，尚未发布`;
    for(const e of $("editor-fields").querySelectorAll('input,textarea'))if(values[e.dataset.editorField]===e.value)e.dataset.dirty='false';
    editorDrafts.set(selectedPlatform,{source:$("editor-source").value,fields:currentEditorValues(),pending:splitDraftPending});
    if([...$("editor-fields").querySelectorAll('input,textarea')].some(e=>e.dataset.dirty==='true'))$("editor-status").textContent+= '，另有新修改待填入';
  }catch(error){if(epoch===editorEpoch)$("editor-status").textContent=error.message;}
  finally{if(epoch===editorEpoch){editorBusy=false;setConnection($("connection-status").textContent,connected);}}
}
async function importPublishingDraft(sourceId, feedbackId) {
  if(editorBusy||role!=="operator")return;
  const epoch=editorEpoch, selectedPlatform=platform, raw=$(sourceId).value;
  const draft=splitPublishingText(raw);
  if(sourceId==='editor-source') {
    for(const kind of ['title','body']) {
      const field=$("editor-fields").querySelector(`[data-editor-kind="${kind}"]`);
      if(field?.dataset.manual==='true')draft[kind]=field.value;
    }
  }
  if(!draft.title){$(feedbackId).textContent='第一行标题不能为空';return;}
  editorBusy=true;setConnection($("connection-status").textContent,connected);
  $(feedbackId).textContent='正在定位编辑页并导入…';
  try {
    const result=await request(`browser/${selectedPlatform}/page-import`,{method:'POST',body:JSON.stringify(draft)});
    if(epoch!==editorEpoch)return;
    if(result.verified!==true||result.count!==2)throw new Error('未能核对导入结果，请重试');
    $(feedbackId).textContent='标题和正文已导入，尚未发布';
    for(const field of $("editor-fields").querySelectorAll('input,textarea')) {
      if(draft[field.dataset.editorKind]===field.value)field.dataset.dirty='false';
    }
    editorScan=null;
    for(const button of $("editor-location-actions").querySelectorAll('button'))button.disabled=true;
    if($(sourceId).value!==raw)$(feedbackId).textContent+='，新修改尚未导入';
    editorDrafts.set(selectedPlatform,{source:$("editor-source").value,fields:currentEditorValues(),pending:splitDraftPending});
  } catch(error) {if(epoch===editorEpoch)$(feedbackId).textContent=error.message;}
  finally {if(epoch===editorEpoch){editorBusy=false;setConnection($("connection-status").textContent,connected);}}
}
for (const button of document.querySelectorAll("[data-platform]"))
  button.addEventListener("click", () => {
    if (uploading) {
      $("upload-status").textContent = "请等待当前上传完成再切换平台";
      showMaterials(true);
      return;
    }
    if (button.dataset.platform === platform) return;
    editorDrafts.set(platform,{source:$("editor-source").value,fields:currentEditorValues(),pending:splitDraftPending});
    const reconnect=wantConnected; disconnect();
    platform = button.dataset.platform;
    mediaLibrary?.reset();
    editorEpoch++;editorBusy=false;
    const savedEditor=editorDrafts.get(platform);
    $("editor-source").value=savedEditor?.source??'';splitDraftPending=savedEditor?.pending??false;
    $("editor-status").textContent='请识别当前平台编辑页';
    editorScan=null;$("editor-fields").replaceChildren();$("editor-location-actions").replaceChildren();
    for (const tab of document.querySelectorAll("[data-platform]"))
      tab.setAttribute(
        "aria-pressed",
        String(tab.dataset.platform === platform),
      );
    $("empty-title").textContent = `${labels[platform]}工作空间`;
    $("empty-copy").textContent = "连接后，在这里登录并操作官方账号。";
    void refreshStatus();
    if(reconnect)void connect();
    if (!$("materials").hidden) void refreshFiles();
  });
$("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("login-button").disabled = true;
  $("login-error").textContent = "";
  try {
    const data = await request("login", {
      method: "POST",
      body: JSON.stringify({
        username: $("username").value,
        password: $("password").value,
      }),
    });
    csrf = data.csrf;
    $("password").value = "";
    await refreshStatus();
  } catch (error) {
    $("login-error").textContent = error.message;
  } finally {
    $("login-button").disabled = false;
  }
});
$("logout").addEventListener("click", async () => {
  try {
    await request("logout", { method: "POST", body: "{}" });
    disconnect();
    $("workspace").hidden = true;
    $("login-view").hidden = false;
    csrf = "";
    eventSocket?.close(); clearTimeout(eventRetryTimer);
  } catch (error) {
    setConnection(error.message);
  }
});
$("connect").addEventListener("click", () => void connect());
$("role-operator").addEventListener("click", () => void chooseRole("operator"));
$("role-observer").addEventListener("click", () => void chooseRole("observer"));
$("picture-quality").addEventListener("change",()=>{if(rfb)rfb.qualityLevel=quality();});
$("zoom-toggle").addEventListener("click",()=>{zoomed=!zoomed;panMode=true;updateViewport();});
$("pan-toggle").addEventListener("click",()=>{if(role==="operator"){panMode=!panMode;updateViewport();}});
$("quick-input").addEventListener("click",()=>{showMaterials(true,"input");$("paste-content").focus({preventScroll:true});});
$("editor-open").addEventListener("click",()=>{showMaterials(true,"editor");if(!editorScan)void scanEditor();});
$("editor-scan").addEventListener("click",()=>void scanEditor());
$("editor-apply").addEventListener("click",()=>void fillEditor());
$("editor-import").addEventListener("click",()=>void importPublishingDraft('editor-source','editor-status'));
$("editor-source").addEventListener("input",()=>{splitDraftPending=true;applySplitDraft(true);});
for(const [id,key] of [["quick-tab",0xff09],["quick-enter",0xff0d],["quick-backspace",0xff08]])$(id).addEventListener("click",()=>{if(rfb&&connected&&role==="operator")rfb.sendKey(key);});
$("expand-view").addEventListener("click",()=>{
  if(window.parent!==window)window.parent.postMessage({type:"kamen-operations:expand"},location.origin);
  else $("fullscreen").click();
});
$("page-controls-toggle").addEventListener('click',()=>{$('page-controls').hidden=!$('page-controls').hidden;$('page-controls-toggle').setAttribute('aria-expanded',String(!$('page-controls').hidden));});
for(const button of document.querySelectorAll('[data-page-command]'))button.addEventListener('click',async()=>{
  if(pageViewBusy||role!=='operator'||!connected)return;pageViewBusy=true;setConnection($('connection-status').textContent,connected);
  try{const result=await request(`browser/${platform}/page-view`,{method:'POST',body:JSON.stringify({command:button.dataset.pageCommand})});if(result.zoom)$('page-zoom-value').textContent=`${Math.round(result.zoom*100)}%`;}
  catch(error){setConnection(error.message,connected);}finally{pageViewBusy=false;setConnection($('connection-status').textContent,connected);}
});
$("restore-window").addEventListener("click",async()=>{try{await request(`browser/${platform}/restore`,{method:"POST",body:"{}"});if(!rfb)void connect();}catch(error){setConnection(error.message,connected);}});
$("chat-shortcut").hidden = true;
$("chat-shortcut").addEventListener("click",()=>window.parent.postMessage({type:"kamen-operations:navigate",workspace:"collaboration"},location.origin));
$("start-control").addEventListener("click", () => void connect());
$("disconnect").addEventListener("click", () => {
  disconnect();
  void refreshStatus();
});
$("materials-toggle").addEventListener("click", () =>
  showMaterials($("materials").hidden),
);
$("materials-close").addEventListener("click", () => showMaterials(false));
$("materials-scrim").addEventListener('click',()=>showMaterials(false));
document.addEventListener('keydown',event=>{
  if(event.key!=='Tab'||$('materials').hidden||!matchMedia('(max-width:900px)').matches)return;
  const controls=[...$('materials').querySelectorAll('button,input,textarea,select,a[href]')].filter(e=>!e.disabled&&e.getClientRects().length);
  if(!controls.length)return;const first=controls[0],last=controls.at(-1);
  if(event.shiftKey&&(document.activeElement===first||!$('materials').contains(document.activeElement))){event.preventDefault();last.focus();}
  else if(!event.shiftKey&&(document.activeElement===last||!$('materials').contains(document.activeElement))){event.preventDefault();first.focus();}
});
$("fullscreen").addEventListener("click", async () => {
  $("fullscreen").closest("details").open = false;
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await $("workspace").requestFullscreen();
  } catch {
    setConnection("当前浏览器不支持全屏，可在电脑或横屏操作");
  }
});
document.addEventListener("keydown",event=>{if(event.key==="Escape"){document.querySelectorAll("details[open]").forEach(detail=>{detail.open=false;});if(!$("materials").hidden)showMaterials(false);}});
mediaLibrary=mountMediaLibrary({request,getPlatform:()=>platform,getRole:()=>role,onBusy:busy=>{uploading=busy;}});
$("paste").addEventListener("click", () => {
  void importPublishingDraft('paste-content','paste-status');
});
$("type-text").addEventListener("click", async () => {
  if (!rfb || !connected || role !== "operator") return;
  const current = rfb;
  for (const char of $("paste-content").value) {
    if (rfb !== current || !connected || role !== "operator") break;
    const code = char.codePointAt(0);
    rfb.sendKey(char === "\n" ? 0xff0d : code > 255 ? 0x01000000 + code : code);
    await new Promise((r) => setTimeout(r, 8));
  }
  $("paste-status").textContent = "输入完成";
});
window.addEventListener("pagehide", () => { disconnect(); eventSocket?.close(); clearInterval(presenceTimer); });
document.addEventListener("visibilitychange",changeVisibility);
window.addEventListener("message",event=>{
  if(event.origin!==location.origin || event.source!==window.parent)return;
  if(event.data?.type==="kamen-operations:visibility"){parentActive=event.data.active===true;changeVisibility();}
  if(event.data?.type==="kamen-operations:reconnect"){retryCount=0;disconnect(true);void connect();}
  if(event.data?.type==="kamen-operations:expanded"){$("expand-view").textContent=event.data.expanded?"收起":"展开";$("expand-view").setAttribute("aria-pressed",String(event.data.expanded===true));}
});
function notifyFocus(){
  const editing=document.activeElement?.matches("input,textarea,[contenteditable=true]")??false;
  if(window.parent!==window)window.parent.postMessage({type:"kamen-operations:editing",editing},location.origin);
  if(editing)requestAnimationFrame(()=>document.activeElement?.scrollIntoView({block:"nearest",inline:"nearest"}));
}
document.addEventListener("focusin",notifyFocus);
document.addEventListener("focusout",()=>requestAnimationFrame(notifyFocus));
presenceTimer=setInterval(sendPresence,10_000);
setInterval(() => {
  if (isActive() && !$("workspace").hidden && eventSocket?.readyState!==WebSocket.OPEN) void refreshStatus();
}, 15000);
$('login-button').disabled=false;
$('login-button').textContent='进入运营台';
void refreshStatus();
