// 用库里的一篇真实笔记拼一份导出网页，写到 visual/shots/export-sample.html（只读库，不往库里写任何东西）。
// 用法：node visual/export-sample.mjs [笔记路径] [输出文件]
//   笔记路径必须给；库的位置用环境变量 VAULT 指定（用来找位置文件）。
// 笔记对应的位置文件（<库>/流程图位置/<笔记路径去掉 .md>.json）有就读进来，没有就用自动排的位置。
import { buildSync } from "esbuild";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildViewer } from "../esbuild.viewer.mjs";

const VAULT = process.env.VAULT;
if (!VAULT) throw new Error("请用环境变量 VAULT 指定笔记库的位置");
const FOLDER = "流程图位置";

if (!process.argv[2]) throw new Error("用法：VAULT=库的位置 node visual/export-sample.mjs 笔记路径 [输出文件]");
const notePath = resolve(process.argv[2]);
const outPath = resolve(process.argv[3] ?? "visual/shots/export-sample.html");
const rel = relative(VAULT, notePath);

// 位置文件
const posFile = join(VAULT, FOLDER, rel.replace(/\.md$/i, "") + ".json");
let diagrams = {};
if (existsSync(posFile)) {
  diagrams = JSON.parse(readFileSync(posFile, "utf8")).diagrams ?? {};
  console.log("读到位置文件：", posFile);
} else {
  console.log("没有位置文件（用自动排的位置）：", posFile);
}

// export.ts 是纯函数，打成一个临时模块直接 import
const tmp = mkdtempSync(join(tmpdir(), "outline-flow-sample-"));
const mod = join(tmp, "export.mjs");
buildSync({ entryPoints: ["src/export.ts"], bundle: true, format: "esm", outfile: mod, loader: { ".css": "text" }, logLevel: "error" });
const { buildExportHtml, collectCharts } = await import(pathToFileURL(mod).href);

const title = basename(notePath).replace(/\.md$/i, "");
const charts = collectCharts(readFileSync(notePath, "utf8"), title).map((c) => ({
  ...c,
  data: diagrams[c.id] ?? { pos: {} },
}));
const d = new Date();
const pad = (n) => String(n).padStart(2, "0");
const html = buildExportHtml(
  {
    title,
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    charts,
    settings: { theme: "card", direction: "LR", line: "poly", structure: "trunk", snap: true, height: 420 },
  },
  await buildViewer(),
);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, html);
console.log(`${charts.length} 张图 -> ${outPath}（${(statSync(outPath).size / 1024).toFixed(0)} KB）`);
