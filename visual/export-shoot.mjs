// 给导出网页拍浅色和深色两张图，并收集控制台报错。
// 用法：node visual/export-shoot.mjs [网页] [窗口宽x高，默认 1280x1100]
// 产物在网页旁边：<名字>-light.png、<名字>-dark.png。
// 用 Chrome 的调试协议（Node 自带 WebSocket，不用装别的）：Emulation.setEmulatedMedia 切深浅色，
// 和系统真的切换一样，页面里 prefers-color-scheme 的监听也会触发。
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const CHROME = [
  process.env.CHROME,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
].find((p) => p && existsSync(p));
if (!CHROME) throw new Error("找不到 Chrome。设一下环境变量 CHROME，指向 Chrome 的可执行文件");

const page = resolve(process.argv[2] ?? "visual/shots/export-sample.html");
const [W, H] = (process.argv[3] ?? "1280x1100").split("x").map(Number);
const stem = join(dirname(page), basename(page, ".html"));
const PORT = 9300 + Math.floor(Math.random() * 500);

const chrome = spawn(CHROME, [
  "--headless=new",
  "--disable-gpu",
  "--hide-scrollbars",
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), "outline-flow-chrome-"))}`,
  `--window-size=${W},${H}`,
  "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tabs = null;
for (let i = 0; i < 50 && !tabs; i++) {
  try {
    tabs = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  } catch {
    await sleep(200);
  }
}
if (!tabs) throw new Error("连不上 Chrome 的调试端口");
const ws = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));

let id = 0;
const waiting = new Map();
const problems = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && waiting.has(m.id)) {
    const { ok, fail } = waiting.get(m.id);
    waiting.delete(m.id);
    m.error ? fail(new Error(m.error.message)) : ok(m.result);
  } else if (m.method === "Runtime.exceptionThrown") {
    problems.push("未捕获的异常：" + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text));
  } else if (m.method === "Runtime.consoleAPICalled" && ["error", "assert"].includes(m.params.type)) {
    problems.push("console." + m.params.type + "：" + m.params.args.map((a) => a.value ?? a.description).join(" "));
  } else if (m.method === "Log.entryAdded" && m.params.entry.level === "error") {
    problems.push("日志错误：" + m.params.entry.text + " " + (m.params.entry.url ?? ""));
  }
};
const send = (method, params = {}) =>
  new Promise((ok, fail) => {
    const i = ++id;
    waiting.set(i, { ok, fail });
    ws.send(JSON.stringify({ id: i, method, params }));
  });

await send("Page.enable");
await send("Runtime.enable");
await send("Log.enable");
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });

for (const scheme of ["light", "dark"]) {
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
  await send("Page.navigate", { url: pathToFileURL(page).href });
  await sleep(1500);
  const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const png = `${stem}-${scheme}.png`;
  writeFileSync(png, Buffer.from(shot.data, "base64"));
  console.log(`${scheme}: ${png}`);
}

// 在已经打开的页面里再切一次深浅色，看图的主题是不是跟着换（不重新加载）
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
await sleep(500);
const live = await send("Runtime.evaluate", {
  expression: `[...document.querySelectorAll(".outline-flow-stage")].map((s) => s.style.background).join(" | ")`,
  returnByValue: true,
});
console.log("实时切回浅色后的画布底色：", live.result.value.slice(0, 200));

ws.close();
chrome.kill();
console.log(problems.length ? `控制台报错 ${problems.length} 条：\n` + problems.join("\n") : "控制台没有报错");
process.exit(problems.length ? 1 : 0);
