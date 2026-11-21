// 把一个库里每篇笔记都按导出网页的样子画出来，整页截图，方便一眼扫过去找显示问题。只读库。
// 用法：VAULT=/path/to/库 node visual/vault-shots.mjs [输出目录，默认 visual/shots/vault]
import { buildSync } from "esbuild";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildViewer } from "../esbuild.viewer.mjs";

const VAULT = process.env.VAULT;
if (!VAULT) throw new Error("请用环境变量 VAULT 指定笔记库的位置");
const OUT = resolve(process.argv[2] ?? "visual/shots/vault");
const ONLY = process.env.ONLY ?? "";
mkdirSync(OUT, { recursive: true });

const settings = JSON.parse(readFileSync(join(VAULT, ".obsidian/plugins/outline-flow/data.json"), "utf8"));
const FOLDER = settings.folder ?? "流程图位置";

const tmp = mkdtempSync(join(tmpdir(), "outline-flow-vault-"));
const mod = join(tmp, "export.mjs");
buildSync({ entryPoints: ["src/export.ts"], bundle: true, format: "esm", outfile: mod, loader: { ".css": "text" }, logLevel: "error" });
const { buildExportHtml, collectCharts } = await import(pathToFileURL(mod).href);
const viewer = await buildViewer();

const notes = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== FOLDER) walk(p);
    } else if (name.endsWith(".md")) notes.push(p);
  }
})(VAULT);

const pages = [];
for (const p of notes.sort()) {
  const rel = relative(VAULT, p);
  if (ONLY && !rel.includes(ONLY)) continue;
  const posFile = join(VAULT, FOLDER, rel.replace(/\.md$/i, "") + ".json");
  const diagrams = existsSync(posFile) ? JSON.parse(readFileSync(posFile, "utf8")).diagrams ?? {} : {};
  const title = rel.replace(/\.md$/i, "").split("/").pop();
  // NEAR=1：打开「关联靠近」看效果（不改库里的设置）
  const charts = collectCharts(readFileSync(p, "utf8"), title).map((c) => ({ ...c, data: { ...(diagrams[c.id] ?? { pos: {} }), ...(process.env.NEAR ? { nearRefs: true, pos: {} } : {}) } }));
  if (!charts.length) continue;
  const html = buildExportHtml({ title: rel, date: "", charts, settings: { ...settings, structure: settings.structure ?? "trunk" } }, viewer);
  const file = join(OUT, rel.replace(/[\/]/g, "__").replace(/\.md$/i, ".html"));
  writeFileSync(file, html);
  pages.push(file);
}
console.log(`${pages.length} 篇有图`);
if (process.env.NOSHOT) process.exit(0); // 只要网页，不截图

// 截图：Chrome 调试协议，整页
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9300 + Math.floor(Math.random() * 500);
const W = 1600;
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "of-chrome-"))}`, `--window-size=${W},1000`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tabs = null;
for (let i = 0; i < 50 && !tabs; i++) {
  try {
    tabs = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  } catch {
    await sleep(200);
  }
}
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
  } else if (m.method === "Runtime.exceptionThrown") problems.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
};
const send = (method, params = {}) => new Promise((ok, fail) => { const i = ++id; waiting.set(i, { ok, fail }); ws.send(JSON.stringify({ id: i, method, params })); });
await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
for (const page of pages) {
  const before = problems.length;
  await send("Emulation.setDeviceMetricsOverride", { width: W, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: pathToFileURL(page).href });
  await sleep(1200);
  const h = (await send("Runtime.evaluate", { expression: "document.documentElement.scrollHeight", returnByValue: true })).result.value;
  await send("Emulation.setDeviceMetricsOverride", { width: W, height: Math.min(h, 6000), deviceScaleFactor: 1, mobile: false });
  await sleep(500);
  const shot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(page.replace(/\.html$/, ".png"), Buffer.from(shot.data, "base64"));
  if (problems.length > before) console.log("报错：", page, problems.slice(before).join(" | "));
}
ws.close();
chrome.kill();
console.log("截图完成", problems.length ? `，报错 ${problems.length} 条` : "，没有报错");
process.exit(0);
