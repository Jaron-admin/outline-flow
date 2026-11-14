import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

// 界面语言：词典、占位符、名字随语言切换，以及「源码里不能再有写死的中文」。
// 几个模块要共用同一个 i18n 实例（setLang 才对它们都生效），所以打成一个包再 import。
const out = join(mkdtempSync(join(tmpdir(), "outline-flow-i18n-")), "all.mjs");
buildSync({
  stdin: {
    contents: [
      'export * as i18n from "./src/i18n.ts";',
      'export * as themes from "./src/themes.ts";',
      'export * as edit from "./src/edit.ts";',
      'export * as graph from "./src/graph.ts";',
      'export * as exp from "./src/export.ts";',
    ].join("\n"),
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  outfile: out,
  loader: { ".css": "text" },
  logLevel: "error",
});
const { i18n, themes, edit, graph, exp } = await import(pathToFileURL(out).href);
const { t, setLang, getLang, detectLang, dictionaries } = i18n;

const IDEOGRAPH = /[㐀-鿿]/;
const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test("默认语言是中文", () => {
  assert.equal(getLang(), "zh");
});

test("词典：en 和 zh 的 key 完全一样，没有空值", () => {
  const zhKeys = Object.keys(dictionaries.zh).sort();
  const enKeys = Object.keys(dictionaries.en).sort();
  assert.deepEqual(enKeys, zhKeys);
  assert.ok(zhKeys.length > 100, `只有 ${zhKeys.length} 条`);
  for (const lang of ["en", "zh"]) {
    for (const [k, v] of Object.entries(dictionaries[lang])) {
      assert.equal(typeof v, "string", `${lang}.${k}`);
      assert.ok(v.trim().length > 0, `${lang}.${k} 是空的`);
    }
  }
});

test("词典：两种语言的占位符一致；英文里没有汉字", () => {
  for (const k of Object.keys(dictionaries.zh)) {
    assert.deepEqual(placeholders(dictionaries.en[k]), placeholders(dictionaries.zh[k]), `${k} 的占位符对不上`);
    assert.ok(!IDEOGRAPH.test(dictionaries.en[k]), `en.${k} 里有汉字`);
  }
});

test("t：{name} 占位符替换；没给的原样留着；可以指定语言", () => {
  assert.equal(t("export.chartN", { n: 3 }), "图 3");
  assert.equal(t("export.chartN", { n: 3 }, "en"), "Chart 3");
  assert.equal(t("export.done", {}, "en"), "Exported: {path}");
  assert.equal(t("export.done", { path: "a/b.html" }, "en"), "Exported: a/b.html");
  // 同一个占位符出现多次也都换
  assert.equal(t("status.line", { where: "W", tip: "T", unsaved: "U" }, "en"), "W TU");
  // 数字会转成字
  assert.equal(t("settings.height.desc", { min: 200, max: 1200 }, "en"), "In pixels, between 200 and 1200. Takes effect after you reopen the note.");
  // 带 $ 的值不会被当成替换模式
  assert.equal(t("export.done", { path: "$&x" }, "en"), "Exported: $&x");
});

test("语言：主题、结构、线型、方向的名字跟着 setLang 变", () => {
  try {
    setLang("zh");
    assert.equal(themes.themeName("card"), "浅色卡片");
    assert.equal(themes.structureName("mindmap"), "思维导图");
    assert.equal(themes.lineModeName("poly"), "折线");
    assert.equal(themes.directionName("LR"), "从左到右");
    assert.deepEqual(themes.themeGroups().map((g) => g.title), ["分支配色", "单色"]);
    setLang("en");
    assert.equal(getLang(), "en");
    assert.equal(themes.themeName("card"), "Light Card");
    assert.equal(themes.structureName("mindmap"), "Mind map");
    assert.equal(themes.lineModeName("poly"), "Elbow");
    assert.equal(themes.directionName("TB"), "Top to bottom");
    assert.deepEqual(themes.themeGroups().map((g) => g.title), ["Branch colors", "Single color"]);
    assert.deepEqual(themes.structureOptions().map((o) => o.label), ["Mind map", "Logic chart", "Org chart", "Radial map"]);
    assert.deepEqual(
      ["trunk", "flow", "brace", "timeline", "fishbone"].map((s) => themes.structureName(s)),
      ["Trunk", "Flowchart", "Brace map", "Timeline", "Fishbone"],
    );
    // 每套主题在两种语言里都有名字（不会回落成 key）
    for (const k of Object.keys(themes.THEMES)) {
      setLang("en");
      assert.notEqual(themes.themeName(k), k, `en 缺 ${k}`);
      setLang("zh");
      assert.notEqual(themes.themeName(k), k, `zh 缺 ${k}`);
    }
    setLang("en");
    const names = themes.themeGroups().flatMap((g) => g.items.map((i) => i.label));
    assert.equal(names.length, 17);
    assert.deepEqual(
      [...names].sort(),
      ["Aurora", "Colorful", "Dark", "Fog Blue", "Ink & Paper", "Light Card", "Manuscript", "Mint", "Mono", "Morandi", "Neon", "Night", "Pine Smoke", "Plain", "Print", "Sunset", "Yellow Accent"],
    );
    assert.equal(themes.themeName("没有这套"), "没有这套");
  } finally {
    setLang("zh");
  }
});

test("语言：大纲写法警告、概要注释、改笔记失败的原因都会翻译", () => {
  try {
    const src = "根\n  甲 #a\n  乙 #a\n  丙\n";
    setLang("zh");
    assert.match(graph.buildElements(src).find((e) => e.group === "warnings").data.text, /「乙 #a」这一行：#名字 在流程图里是节点编号/);
    assert.equal(graph.toFlowchartFun("A\n  B\n  }:2\n"), "A\n  B\n  // 概要前 2 项\n");
    assert.equal(edit.setNodeText("a", { mode: "outline" }, 9, "x").reason, "这个节点在笔记里找不到对应的行");
    setLang("en");
    const w = graph.buildElements(src).find((e) => e.group === "warnings").data.text;
    assert.equal(w, 'Line "乙 #a": #name is a node ID in a flowchart, and this one repeats an earlier ID. Shown as plain text for now.');
    assert.equal(graph.toFlowchartFun("A\n  B\n  }:2\n"), "A\n  B\n  // Summary of previous 2 items\n");
    assert.equal(graph.toFlowchartFun("A\n  B\n  } 总结\n"), "A\n  B\n  // 总结\n");
    const bad = edit.setNodeText("a", { mode: "outline" }, 9, "x");
    assert.equal(bad.ok, false);
    assert.equal(bad.reason, "Can't find the line for this node in the note");
    assert.equal(edit.applyEdit("没有代码块", { mode: "block", index: 0 }, "x", { kind: "setText", line: 1, text: "y" }).reason, "Can't find this chart in the note anymore");
    assert.equal(edit.removedSectionNotice(), "Deleted the whole section. Press ⌘Z to undo.");
  } finally {
    setLang("zh");
  }
});

test("语言：导出网页的 lang 属性、日期那行、没有标题的图名都跟着导出时的语言", () => {
  const payload = (over = {}) => ({
    title: "笔记",
    date: "2026-11-11",
    charts: [
      { id: "0", title: "图一", source: "甲\n  乙", data: { pos: {} } },
      { id: "1", title: "图二", source: "丙\n  丁", data: { pos: {} } },
    ],
    settings: { theme: "card", direction: "LR", line: "poly", structure: "logic", snap: true, height: 420 },
    ...over,
  });
  try {
    // 老数据没有 lang，当前语言是中文：和以前一样
    let html = exp.buildExportHtml(payload(), "");
    assert.match(html, /<html lang="zh-CN">/);
    assert.match(html, /<div class="meta">2 张流程图 · 2026-11-11 导出<\/div>/);
    // payload 里写了 en：不管当前语言是什么，网页都是英文
    html = exp.buildExportHtml(payload({ lang: "en" }), "");
    assert.match(html, /<html lang="en">/);
    assert.match(html, /<div class="meta">2 charts · exported 2026-11-11<\/div>/);
    html = exp.buildExportHtml(payload({ lang: "en", charts: payload().charts.slice(0, 1) }), "");
    assert.match(html, /<div class="meta">1 chart · exported 2026-11-11<\/div>/);
    html = exp.buildExportHtml(payload({ lang: "zh" }), "");
    assert.match(html, /<html lang="zh-CN">/);
    // lang 存进了页面数据，网页查看器靠它设语言
    assert.match(exp.buildExportHtml(payload({ lang: "en" }), ""), /"lang":"en"/);
    // 没有标题的图
    const md = "```flow\nA\n  B\n```\n";
    setLang("en");
    assert.equal(exp.collectCharts(md, "n")[0].title, "Chart 1");
    setLang("zh");
    assert.equal(exp.collectCharts(md, "n")[0].title, "图 1");
  } finally {
    setLang("zh");
  }
});

test("detectLang：getLanguage 以 zh 开头是中文，别的是英文；没有 getLanguage 就读 localStorage", () => {
  const had = Object.prototype.hasOwnProperty.call(globalThis, "window");
  const saved = globalThis.window;
  const withStorage = (value) => {
    globalThis.window = { localStorage: { getItem: (k) => (k === "language" ? value : "不该读到这个") } };
  };
  try {
    assert.equal(detectLang({ getLanguage: () => "zh" }), "zh");
    assert.equal(detectLang({ getLanguage: () => "zh-TW" }), "zh");
    assert.equal(detectLang({ getLanguage: () => "en" }), "en");
    assert.equal(detectLang({ getLanguage: () => "fr" }), "en");
    // 有 getLanguage 就不看 localStorage
    withStorage("en");
    assert.equal(detectLang({ getLanguage: () => "zh" }), "zh");
    // 没有这个函数（Obsidian 1.8.7 以前）：读 localStorage
    withStorage("zh-TW");
    assert.equal(detectLang({}), "zh");
    assert.equal(detectLang(undefined), "zh");
    withStorage("zh");
    assert.equal(detectLang({ getLanguage: "不是函数" }), "zh");
    withStorage("ja");
    assert.equal(detectLang({}), "en");
    // Obsidian 没存过语言就是英文
    withStorage(null);
    assert.equal(detectLang({}), "en");
    // getLanguage 抛错、localStorage 抛错都不能让插件起不来
    withStorage("zh");
    assert.equal(detectLang({ getLanguage: () => { throw new Error("x"); } }), "zh");
    globalThis.window = { localStorage: { getItem: () => { throw new Error("denied"); } } };
    assert.equal(detectLang({}), "en");
    // 没有 window（node）
    delete globalThis.window;
    assert.equal(detectLang({}), "en");
  } finally {
    if (had) globalThis.window = saved;
    else delete globalThis.window;
  }
});

// ---------- 源码里不能再有写死的中文 ----------

/**
 * 白名单：这些中文 / 全角字符是「解析大纲」用的，不是给用户看的字。逐条列出来，方便审。
 * 键是文件名，值是源码里那个字符串字面量的原文（连引号）。
 * 另外：正则字面量（/…/）里的全角标点（：（）【】｝ 等）不查，只要求里面没有汉字。
 */
const ALLOWED_STRINGS = {
  "edit.ts": [
    '"【"', // 备注的开头括号，找它在行里的位置
  ],
  "graph.ts": [
    '"\\\\（"', // 全角括号前加反斜杠转义，免得被当成引用
    '"\\\\）"',
    '"；"', // 多条备注之间的分隔
  ],
  "wrap.ts": [
    '"，。、；：！？）》」』】〕〉〗”’…·%,.;:!?)]}>～—‰"', // 不能放在行首的标点
    '"（《「『【〔〈〖“‘([{<"', // 不能放在行尾的标点
  ],
};
const CJK = /[　-〿㐀-鿿＀-￯]/;

function scan(file, text) {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2020, true);
  const bad = [];
  const visit = (n) => {
    const isStr = ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n);
    const isRe = ts.isRegularExpressionLiteral(n);
    if (isStr || isRe) {
      const src = n.getText();
      const hit = isRe ? IDEOGRAPH.test(src) : CJK.test(src) && !(ALLOWED_STRINGS[file] ?? []).includes(src);
      if (hit) bad.push(`${file}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1} ${src.slice(0, 60)}`);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return bad;
}

test("源码：src/*.ts（除 i18n.ts）里没有写死的中文字符串，注释不算", () => {
  const files = readdirSync("src").filter((f) => f.endsWith(".ts") && f !== "i18n.ts");
  assert.ok(files.includes("main.ts") && files.includes("graph.ts"));
  const bad = files.flatMap((f) => scan(f, readFileSync(join("src", f), "utf8")));
  assert.deepEqual(bad, []);
});

test("源码扫描本身：能抓到字符串、模板里的中文，不管注释，白名单条目要真的存在", () => {
  assert.equal(scan("x.ts", 'const a = "你好";').length, 1);
  assert.equal(scan("x.ts", "const a = `共 ${n} 个`;").length, 2); // 模板的头和尾各算一处
  assert.equal(scan("x.ts", "const a = `${n} 个`;").length, 1);
  assert.equal(scan("x.ts", "const a = /汉字/;").length, 1);
  assert.equal(scan("x.ts", "// 你好\n/* 你好 */\nconst a = 1; // 注释\n").length, 0);
  assert.equal(scan("x.ts", "const a = /【[^】]*】/;").length, 0);
  // 白名单里的每一条都真的出现在对应文件里，不会留着没用的
  for (const [file, list] of Object.entries(ALLOWED_STRINGS)) {
    const text = readFileSync(join("src", file), "utf8");
    for (const lit of list) assert.ok(text.includes(lit), `${file} 里已经没有 ${lit}`);
  }
});
