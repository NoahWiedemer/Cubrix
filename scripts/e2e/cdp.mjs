// Usage: node cdp.mjs <url> <steps.json>; steps: {wait}, {shot:path}, {js:code}, {drag:[x1,y1,x2,y2,steps]}, {click:[x,y]}, {key:...}
import fs from "fs";
const [,, url, stepsFile] = process.argv;
const steps = JSON.parse(fs.readFileSync(stepsFile, "utf8"));
const t = await (await fetch("http://127.0.0.1:9333/json/new?" + encodeURIComponent(url), { method: "PUT" })).json();
const ws = new WebSocket(t.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); pending.get(d.id)?.(d); };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await new Promise((r) => (ws.onopen = r));
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mouse = (type, x, y, extra = {}) => send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1, ...extra });
for (const s of steps) {
  if (s.wait) await sleep(s.wait);
  if (s.js) { const r = await send("Runtime.evaluate", { expression: s.js, awaitPromise: true, returnByValue: true }); if (s.log) console.log(JSON.stringify(r.result?.result?.value)); }
  if (s.shot) { const r = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(s.shot, Buffer.from(r.result.data, "base64")); }
  if (s.move) await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: s.move[0], y: s.move[1] });
  if (s.click) { await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: s.click[0], y: s.click[1] }); await mouse("mousePressed", ...s.click); await mouse("mouseReleased", ...s.click); }
  if (s.cdp) await send(s.cdp[0], s.cdp[1] ?? {});
  if (s.down) await mouse("mousePressed", ...s.down);
  if (s.hold) await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: s.hold[0], y: s.hold[1], button: "left", buttons: 1 });
  if (s.up) await mouse("mouseReleased", ...s.up);
  if (s.sdrag) {
    const [x1, y1, x2, y2, n] = s.sdrag;
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: x1, y: y1, button: "left", buttons: 1, clickCount: 1, modifiers: 8 });
    for (let i = 1; i <= n; i++) { await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x1 + ((x2 - x1) * i) / n, y: y1 + ((y2 - y1) * i) / n, button: "left", buttons: 1, modifiers: 8 }); await sleep(16); }
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: x2, y: y2, button: "left", buttons: 0, clickCount: 1, modifiers: 8 });
  }
  if (s.drag) {
    const [x1, y1, x2, y2, n, shotAt, shotPath] = s.drag;
    await mouse("mousePressed", x1, y1);
    for (let i = 1; i <= n; i++) {
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x1 + ((x2 - x1) * i) / n, y: y1 + ((y2 - y1) * i) / n, button: "left", buttons: 1 });
      await sleep(16);
      if (i === shotAt) { const r = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(shotPath, Buffer.from(r.result.data, "base64")); }
    }
    await mouse("mouseReleased", x2, y2);
  }
}
ws.close(); process.exit(0);
