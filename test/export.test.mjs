import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// 导出网页的两个纯函数：拼网页文字、从笔记里找出要导出的图。
// export.ts 会把 styles.css 当文字读进来，所以打包时要开 text 加载器。
const out = join(mkdtempSync(join(tmpdir(), "outline-flow-export-")), "export.mjs");
buildSync({ entryPoints: ["src/export.ts"], bundle: true, format: "esm", outfile: out, loader: { ".css": "text" }, logLevel: "error" });
const { buildExportHtml, collectCharts } = await import(pathToFileURL(out).href);

const payload = (over = {}) => ({
  title: "笔记",
  date: "2026-11-11",
  charts: [{ id: "0", title: "图一", source: "甲\n  乙", data: { pos: {} } }],
  settings: { theme: "card", direction: "LR", line: "poly", structure: "trunk", snap: true, height: 420 },
  ...over,
});

test("导出网页：数据和代码里的 </script> 都不会提前结束 script 标签", () => {
  const evil = "</script><script>alert(1)</script>";
  const html = buildExportHtml(
    payload({ title: evil, charts: [{ id: "0", title: evil, source: evil, data: { pos: {}, theme: "card" } }] }),
    `var a = "${evil}"; var b = "</SCRIPT>"; // <!-- 注释`,
  );
  // 整页里的 </script> 只能有三个：数据一个、系统判断一个、代码一个，没有被里面的内容提前结束的
  assert.equal((html.match(/<\/script/gi) ?? []).length, 3);
  // 数据：< 换成 <，读回来和原来一样
  const json = /<script type="application\/json" id="outline-flow-data">([\s\S]*?)<\/script>/.exec(html)[1];
  assert.ok(!json.includes("<"));
  assert.equal(JSON.parse(json).charts[0].source, evil);
  // 代码：</script 变成 <\/script，原样还是同一段 JS（最后一段脚本是查看器）
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  const code = scripts[scripts.length - 1][1];
  assert.ok(!/<\/script/i.test(code));
  assert.ok(code.includes("<\\/script>"));
  assert.ok(code.includes("<\\/SCRIPT>"));
  assert.ok(!code.includes("<!--"));
  assert.equal(new Function(code + "\n; return a;")(), evil);
});

test("导出网页：标题进 <title> 和 h1 时转义，页面信息行是图的张数和日期", () => {
  const html = buildExportHtml(payload({ title: `A & <b>"B"` }), "");
  assert.match(html, /<title>A &amp; &lt;b&gt;&quot;B&quot;<\/title>/);
  assert.match(html, /<h1>A &amp; &lt;b&gt;&quot;B&quot;<\/h1>/);
  assert.match(html, /<div class="meta">1 张流程图 · 2026-11-11 导出<\/div>/);
  assert.ok(html.startsWith("<!doctype html>"));
  // 深浅色靠样式里的 prefers-color-scheme，不用联网
  assert.ok(html.includes("prefers-color-scheme: dark"));
  assert.ok(html.includes("<script>window.__outlineFlowIsMac=/Mac|iPhone|iPad/i.test(navigator.platform||navigator.userAgent);</script>"));
  assert.ok(!/<link\b|src="http|href="http/i.test(html));
});

test("找要导出的图：每个 flow 代码块一张，名字取上面最近的标题，没有就叫「图 N」", () => {
  const md = [
    "---",
    "# 属性区里的井号不是标题",
    "---",
    "前言",
    "```flow",
    "甲",
    "```",
    "# 安装 **Node**",
    "```js",
    "# 代码里的井号也不是标题",
    "```",
    "~~~flow",
    "乙",
    "~~~",
    "## 第一个流程",
    "```flow",
    "丙",
    "```",
  ].join("\n");
  assert.deepEqual(collectCharts(md, "笔记"), [
    { id: "0", title: "图 1", source: "甲" },
    { id: "1", title: "安装 Node", source: "乙" },
    { id: "2", title: "第一个流程", source: "丙" },
  ]);
});

test("找要导出的图：没有 flow 代码块就把整篇大纲当一张，和侧栏一样用 __outline__，名字是笔记名", () => {
  const md = "# 总\n- 甲\n  - 乙\n正文\n";
  const charts = collectCharts(md, "我的笔记");
  assert.equal(charts.length, 1);
  assert.equal(charts[0].id, "__outline__");
  assert.equal(charts[0].title, "我的笔记");
  assert.equal(charts[0].source, "总\n  - 甲\n    - 乙");
  // 什么大纲都没有：没有图可导
  assert.deepEqual(collectCharts("只有一段话\n", "x"), []);
});
