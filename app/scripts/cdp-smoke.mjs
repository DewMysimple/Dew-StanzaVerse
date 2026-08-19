/**
 * CDP 冒烟测试：真实时间等待页面加载 + 自动入场 + 滚动，收集控制台输出并截图。
 * 用法：node scripts/cdp-smoke.mjs <url> <截图路径> [滚动比例0~1]
 * 依赖：Node 22+ 内置 WebSocket / fetch，无需安装任何包。
 */
const [url, shotPath, scrollRatioArg, evalExpr, viewportWidthArg, viewportHeightArg, mediaModeArg] = process.argv.slice(2);
const scrollRatio = Number(scrollRatioArg ?? 0);
const CDP_PORT = 9333;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getTargetWs() {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
      const targets = await res.json();
      const page = targets.find((t) => t.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(500);
  }
  throw new Error("找不到 CDP 页面目标");
}

const ws = new WebSocket(await getTargetWs());
let msgId = 0;
const pending = new Map();
const consoleLines = [];

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id).resolve(msg.result);
    pending.delete(msg.id);
  } else if (msg.method === "Runtime.consoleAPICalled") {
    const text = msg.params.args.map((a) => a.value ?? a.description ?? "").join(" ");
    consoleLines.push(`[${msg.params.type}] ${text}`);
  } else if (msg.method === "Runtime.exceptionThrown") {
    consoleLines.push(`[EXCEPTION] ${msg.params.exceptionDetails.text} ${msg.params.exceptionDetails.exception?.description ?? ""}`);
  }
};

await new Promise((r) => (ws.onopen = r));
await send("Runtime.enable");
await send("Page.enable");
await send("Emulation.setEmulatedMedia", {
  media: "screen",
  features: [{ name: "prefers-reduced-motion", value: mediaModeArg === "reduce" ? "reduce" : "no-preference" }],
});
if (viewportWidthArg && viewportHeightArg) {
  await send("Emulation.setDeviceMetricsOverride", {
    width: Number(viewportWidthArg),
    height: Number(viewportHeightArg),
    deviceScaleFactor: 1,
    mobile: Number(viewportWidthArg) <= 600,
  });
  await send("Emulation.setTouchEmulationEnabled", { enabled: Number(viewportWidthArg) <= 600, maxTouchPoints: 5 });
}
await send("Page.navigate", { url });

// 等资源加载 + 入场（#autostart 会在资源齐后 0.5s 自动进入）
await sleep(20000);

// 可选：滚动到指定比例，等相机/显现动画稳定
if (scrollRatio > 0) {
  await send("Runtime.evaluate", {
    expression: `window.scrollTo(0, document.body.scrollHeight * ${scrollRatio})`,
  });
  await sleep(4000);
}

if (evalExpr) {
  const result = await send("Runtime.evaluate", { expression: evalExpr, returnByValue: true });
  console.log("=== EVAL ===");
  console.log(JSON.stringify(result?.result?.value ?? result, null, 2));
  await sleep(2000); // 等改动渲染到画面
}

const shot = await send("Page.captureScreenshot", { format: "png" });
const { writeFileSync } = await import("node:fs");
writeFileSync(shotPath, Buffer.from(shot.data, "base64"));

console.log("=== CONSOLE ===");
consoleLines.forEach((l) => console.log(l));
console.log("=== END ===");
ws.close();
process.exit(0);
