import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const baseUrl = process.argv[2] ?? "http://127.0.0.1:3000/";
const outputRoot = resolve(process.argv[3] ?? ".artifacts/qa/automated");
const CDP_PORT = 9333;
const viewports = [
  { name: "desktop-1440x900", width: 1440, height: 900, mobile: false },
  { name: "desktop-1920x1080", width: 1920, height: 1080, mobile: false },
  { name: "desktop-2560x1440", width: 2560, height: 1440, mobile: false },
  { name: "mobile-390x844", width: 390, height: 844, mobile: true },
  { name: "mobile-430x932", width: 430, height: 932, mobile: true },
];
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
mkdirSync(outputRoot, { recursive: true });

const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
const target = targets.find((item) => item.type === "page");
if (!target) throw new Error("No CDP page target");
const ws = new WebSocket(target.webSocketDebuggerUrl);
let sequence = 0;
const pending = new Map();
const consoleErrors = [];
const remoteResources = new Set();
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message.result);
    pending.delete(message.id);
  } else if (message.method === "Runtime.exceptionThrown") {
    consoleErrors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
  } else if (message.method === "Runtime.consoleAPICalled" && ["error", "assert"].includes(message.params.type)) {
    consoleErrors.push(message.params.args.map((arg) => arg.value ?? arg.description ?? "").join(" "));
  } else if (message.method === "Network.requestWillBeSent") {
    const url = message.params.request.url;
    if (!url.startsWith("http://127.0.0.1:3000/") && !url.startsWith("data:") && !url.startsWith("blob:")) remoteResources.add(url);
  }
};
await new Promise((resolveOpen) => { ws.onopen = resolveOpen; });
const send = (method, params = {}) => new Promise((resolveSend) => {
  const id = ++sequence;
  pending.set(id, resolveSend);
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result?.value;
};
const screenshot = async (path) => {
  const result = await send("Page.captureScreenshot", { format: "png" });
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.from(result.data, "base64"));
};
const waitForExperience = async () => {
  for (let index = 0; index < 80; index++) {
    if (await evaluate("document.documentElement.dataset.experiencePhase === 'scroll'")) return;
    await sleep(250);
  }
  throw new Error("Experience did not enter scroll phase");
};

await send("Runtime.enable");
await send("Page.enable");
await send("Network.enable");
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: "history.scrollRestoration='manual';window.scrollTo(0,0);",
});
const cases = [];
for (const viewport of viewports) {
  await send("Emulation.setEmulatedMedia", { media: "screen", features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
  await send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: viewport.mobile,
  });
  await send("Emulation.setTouchEmulationEnabled", { enabled: viewport.mobile, maxTouchPoints: 5 });
  await send("Page.navigate", { url: `${baseUrl}?seed=47&freeze=6#autostart` });
  await waitForExperience();
  await sleep(1400);
  const caseDir = resolve(outputRoot, viewport.name);
  const layerState = await evaluate(`(()=>{const papers=window.__xp.experienceManager._watercolorView.papers;return {paperCount:papers.length,premature:papers.filter(p=>p.config.startAt>0&&(p.revealed||Math.abs(p.state.rotationZ+Math.PI/2)>.001)).length,titleCount:window.__xp.experienceManager._watercolorView.paintingTitles.configs.length};})()`);
  const scrollStep = await evaluate(`(async()=>{window.__xp.scrollController.scrollToTop();await new Promise(requestAnimationFrame);const before=window.__xp.scrollController.sample.cameraTime;window.scrollTo({top:100,behavior:'instant'});await new Promise(r=>setTimeout(r,250));const after=window.__xp.scrollController.sample.cameraTime;window.__xp.scrollController.scrollToTop();return {before,after,advance:after-before};})()`);
  await screenshot(resolve(caseDir, "00-start.png"));

  const scrollResponse = await evaluate(`(async()=>{const samples=[];window.__xp.scrollController.scrollToCameraTime(24);for(let i=0;i<22;i++){await new Promise(requestAnimationFrame);const s=window.__xp.scrollController.sample;samples.push({t:performance.now(),raw:s.rawProgress,damped:s.dampedProgress});}window.__xp.scrollController.scrollToTop();await new Promise(r=>setTimeout(r,450));return {samples,maxLag:Math.max(...samples.map(s=>Math.abs(s.raw-s.damped))),firstFrameMoved:samples.findIndex(s=>s.damped>0),settledLag:Math.abs(samples.at(-1).raw-samples.at(-1).damped)};})()`);

  let rippleScene = null;
  if (!viewport.mobile) {
    rippleScene = await evaluate(`(async()=>{for(let i=0;i<36;i++){window.dispatchEvent(new PointerEvent('pointermove',{clientX:${viewport.width}*.34+i*${viewport.width}*.006,clientY:${viewport.height}*.5+Math.sin(i*.45)*${viewport.height}*.08,pointerType:'mouse',bubbles:true}));await new Promise(r=>setTimeout(r,24));}await new Promise(r=>setTimeout(r,250));return window.__xp.experienceManager._paintManager.sceneIndex;})()`);
    await screenshot(resolve(caseDir, "01-ripple.png"));
  }
  const brushSample = await evaluate(`(()=>{const s=window.__xp.experienceManager._paintManager.lastBrushSample;return s?{paperIndex:s.paperIndex,radius:s.radius,projectedSize:s.projectedSize,pressed:s.pressed}:null})()`);

  const timings = [];
  for (const time of [8, 24, 44, 55]) {
    await evaluate(`window.__xp.scrollController.scrollToCameraTime(${time})`);
    await sleep(1100);
    timings.push(await evaluate(`(()=>{const sample=window.__xp.scrollController.sample;const visibleTitles=window.__xp.experienceManager._watercolorView.paintingTitles._items.filter(item=>item.alpha>.1).length;return {sample,visibleTitles};})()`));
    await screenshot(resolve(caseDir, `${String(time).padStart(2, "0")}-camera.png`));
  }

  const titleClick = await evaluate(`(async()=>{const manager=window.__xp.experienceManager;const item=manager._watercolorView.paintingTitles._items.find(entry=>entry.alpha>.8);if(!item)return {available:false};const b=item.config.interactionBounds;const x=(b.min.x+b.max.x)/2;const y=(b.min.y+b.max.y)/2;const pointerType=${viewport.mobile ? "'touch'" : "'mouse'"};window.dispatchEvent(new PointerEvent('pointermove',{clientX:x,clientY:y,pointerType,bubbles:true}));await new Promise(requestAnimationFrame);window.dispatchEvent(new PointerEvent('pointerdown',{clientX:x,clientY:y,pointerType,bubbles:true}));await new Promise(r=>setTimeout(r,40));window.dispatchEvent(new PointerEvent('pointerup',{clientX:x,clientY:y,pointerType,bubbles:true}));await new Promise(r=>setTimeout(r,900));const result={available:true,expected:item.config.sceneIndex,visible:manager._fullPaintManager.isVisible,sceneIndex:manager._fullPaintManager.sceneIndex};manager._fullPaintManager.hide();return result;})()`);
  await sleep(500);

  await evaluate("window.__xp.scrollController.scrollToCameraTime(24)");
  await sleep(900);
  await evaluate("window.__xp.experienceManager._fullPaintManager.show(3)");
  await sleep(1600);
  const fullPaintVisible = await evaluate("window.__xp.experienceManager._fullPaintManager.isVisible");
  await screenshot(resolve(caseDir, "60-full-paint.png"));
  await evaluate("window.__xp.experienceManager._fullPaintManager.hide()");
  await sleep(800);

  await evaluate("window.scrollTo({top:document.body.scrollHeight,behavior:'instant'})");
  await sleep(1300);
  await evaluate("document.querySelectorAll('.question-head')[4]?.click()")
  await sleep(500);
  await screenshot(resolve(caseDir, "70-content-faq.png"));
  await evaluate("document.getElementById('restart-btn')?.click()")
  await sleep(1900);
  const restartY = await evaluate("window.scrollY");
  await screenshot(resolve(caseDir, "80-restart.png"));

  cases.push({ ...viewport, layerState, scrollStep, scrollResponse, rippleScene, brushSample, timings, titleClick, fullPaintVisible, restartY });
}

await send("Emulation.setEmulatedMedia", { media: "screen", features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await send("Page.navigate", { url: baseUrl });
await sleep(1800);
await screenshot(resolve(outputRoot, "reduced-motion-390x844.png"));
const reducedFallback = await evaluate("document.documentElement.classList.contains('is-fallback') && !document.getElementById('webgl-fallback').hidden");

const report = {
  checkedAt: new Date().toISOString(),
  cases,
  reducedFallback,
  consoleErrors,
  remoteResources: [...remoteResources],
  passed: reducedFallback
    && consoleErrors.length === 0
    && remoteResources.size === 0
    && cases.every((testCase) => testCase.restartY === 0
      && testCase.fullPaintVisible
      && testCase.layerState.paperCount === 26
      && testCase.layerState.premature === 0
      && testCase.layerState.titleCount === 6
      && testCase.scrollStep.advance >= 0.8
      && testCase.scrollStep.advance <= 1.25
      && testCase.scrollResponse.maxLag <= 0.0151
      && testCase.scrollResponse.firstFrameMoved <= 1
      && testCase.timings.some((entry) => entry.visibleTitles > 0)
      && testCase.titleClick.available
      && testCase.titleClick.visible
      && testCase.titleClick.sceneIndex === testCase.titleClick.expected
      && (testCase.mobile || (testCase.rippleScene === 1 && testCase.brushSample?.radius <= 0.055))),
};
writeFileSync(resolve(outputRoot, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
ws.close();
if (!report.passed) process.exitCode = 1;
