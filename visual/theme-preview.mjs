// 挑主题用的预览页：拿一篇真实笔记，每套主题画一张，按结构分成几页，外面一个带切换的总页。
// 用法：node visual/theme-preview.mjs [笔记路径]   产物：prototype/themes/index.html
import { buildSync } from "esbuild";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { buildViewer } from "../esbuild.viewer.mjs";

const note = process.argv[2];
if (!note) throw new Error("用法：node visual/theme-preview.mjs 笔记路径");
const OUT = "prototype/themes";
mkdirSync(OUT, { recursive: true });

const tmp = mkdtempSync(join(tmpdir(), "outline-flow-themes-"));
buildSync({ entryPoints: ["src/export.ts"], bundle: true, format: "esm", outfile: join(tmp, "export.mjs"), loader: { ".css": "text" }, logLevel: "error" });
buildSync({ entryPoints: ["src/themes.ts"], bundle: true, format: "esm", outfile: join(tmp, "themes.mjs"), logLevel: "error" });
const { buildExportHtml, collectCharts } = await import(pathToFileURL(join(tmp, "export.mjs")).href);
const { THEMES, themeName } = await import(pathToFileURL(join(tmp, "themes.mjs")).href);
const viewer = await buildViewer();

const title = basename(note, ".md");
const chart = collectCharts(readFileSync(note, "utf8"), title)[0];
const NEW = ["colorful", "morandi", "fog", "plain", "inkpaper", "night", "pine", "print"];
const OLD = Object.keys(THEMES).filter((k) => !NEW.includes(k));
const STRUCTS = { mindmap: "思维导图", logic: "逻辑图", org: "组织结构图", radial: "放射图" };

for (const [s, sname] of Object.entries(STRUCTS)) {
  const charts = [...NEW, ...OLD].map((k, i) => ({
    id: String(i),
    title: `${NEW.includes(k) ? "新 · " : "旧 · "}${themeName(k)}`,
    source: chart.source,
    data: { pos: {}, theme: k, structure: s },
  }));
  const html = buildExportHtml(
    { title: `${title} · ${sname}`, date: "", charts, fixedTheme: true, settings: { theme: "card", direction: "LR", line: "poly", structure: s, snap: true, height: 420 } },
    viewer,
  );
  writeFileSync(join(OUT, `${s}.html`), html);
}

writeFileSync(
  join(OUT, "index.html"),
  `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>主题预览</title>
<style>
:root{--bg:#f4f5f7;--fg:#1d2129;--line:#e3e6ec;--on:#1d2129;--onfg:#fff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;display:flex;flex-direction:column;height:100vh}
nav{display:flex;gap:8px;align-items:center;padding:10px 16px;border-bottom:1px solid var(--line);background:#fff;flex-wrap:wrap}
nav b{margin-right:8px}
nav button{border:1px solid var(--line);background:#fff;border-radius:16px;padding:4px 14px;font:inherit;cursor:pointer}
nav button.on{background:var(--on);color:var(--onfg);border-color:var(--on)}
nav span{color:#6b7280;font-size:12px;margin-left:auto}
iframe{flex:1;border:0;width:100%}
</style></head><body>
<nav><b>${title}</b>${Object.entries(STRUCTS).map(([k, n], i) => `<button data-k="${k}"${i ? "" : ' class="on"'}>${n}</button>`).join("")}<span>每张卡片一套主题：「新」是这次配的，「旧」是原来的</span></nav>
<iframe id="f" src="mindmap.html"></iframe>
<script>
document.querySelectorAll("nav button").forEach(b=>b.onclick=()=>{document.querySelectorAll("nav button").forEach(x=>x.classList.toggle("on",x===b));document.getElementById("f").src=b.dataset.k+".html";});
</script></body></html>`,
);
console.log("预览页：" + join(OUT, "index.html"));
