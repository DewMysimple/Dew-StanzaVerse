import { writeFileSync } from "node:fs";

const [shotPath, expression = "document.title"] = process.argv.slice(2);
const targets = await (await fetch("http://127.0.0.1:9333/json/list")).json();
const page = targets.find((target) => target.type === "page" && target.url.includes("127.0.0.1:3000"));
if (!page) throw new Error("No local experience CDP target is open");

const socket = new WebSocket(page.webSocketDebuggerUrl);
let sequence = 0;
const pending = new Map();

socket.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  pending.get(message.id)(message.result);
  pending.delete(message.id);
};

await new Promise((resolve) => { socket.onopen = resolve; });
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++sequence;
  pending.set(id, resolve);
  socket.send(JSON.stringify({ id, method, params }));
});

const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
console.log(JSON.stringify(result?.result?.value ?? result, null, 2));
await new Promise((resolve) => setTimeout(resolve, 500));
if (shotPath) {
  const screenshot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(shotPath, Buffer.from(screenshot.data, "base64"));
}
socket.close();
