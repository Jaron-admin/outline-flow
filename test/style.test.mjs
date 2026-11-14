import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import cytoscape from "cytoscape";

// 样式表的坑只有真正交给 cytoscape 算一遍才会暴露（顺序覆盖、端点规范化），所以这里跑 headless。
// 每次算完立刻 destroy，不然会有一堆实例拖着不让测试进程退出。
const out = join(mkdtempSync(join(tmpdir(), "outline-flow-style-")), "themes.mjs");
buildSync({ entryPoints: ["src/themes.ts"], bundle: true, format: "esm", outfile: out, logLevel: "error" });
const { styleFor, THEMES, isDarkTheme, themeForMode } = await import(pathToFileURL(out).href);

/** 把 styleFor 的输出交给 cytoscape 算一遍，返回这条边若干属性的最终值 */
function props(theme, dir, line, classes, keys, structure = "logic") {
  const cy = cytoscape({
    headless: true,
    styleEnabled: true,
    warnings: false,
    elements: [
      { data: { id: "a" } },
      { data: { id: "b" } },
      { data: { id: "s", source: "a", target: "b", label: "组名" }, classes },
    ],
    style: styleFor(theme, dir, "sans-serif", line, structure),
  });
  const e = cy.getElementById("s");
  const snap = Object.fromEntries(keys.map((k) => [k, e.style(k)]));
  cy.destroy();
  return snap;
}

test("概要线不管哪种线型、哪种结构，都必须是 round-segments", () => {
  // 样式表按出现顺序应用、后者覆盖前者（不看选择器特异性），所以「概要规则必须放最后」
  // 这件事得有测试守着：哪天又把它挪到前面，花括号就会静悄悄退回成一条 taxi 折线。
  for (const line of ["poly", "straight", "curve"]) {
    for (const theme of ["card", "dark", "yellow", "line"]) {
      const s = props(theme, "LR", line, "summary", ["curve-style"]);
      assert.equal(s["curve-style"], "round-segments", `${theme}/${line} 的概要线被通用 edge 规则盖掉了`);
    }
  }
});

test("三种线型落到 cytoscape 上各是各的", () => {
  // 旧版的「弧线」其实是直线，改名成 straight 了；curve 现在是真的贝塞尔。
  assert.equal(props("card", "LR", "poly", "", ["curve-style"])["curve-style"], "round-taxi");
  assert.equal(props("card", "LR", "straight", "", ["curve-style"])["curve-style"], "straight");
  assert.equal(props("card", "LR", "curve", "", ["curve-style"])["curve-style"], "unbundled-bezier");
  // 引用线三种模式下都弯（否则回路箭头正好压在主线上看不出来）
  for (const line of ["straight", "curve"]) {
    assert.equal(props("card", "LR", line, "ref", ["curve-style"])["curve-style"], "unbundled-bezier");
  }
});

test("结构专属的线：鱼骨图是折好的线段、时间轴主干更粗、括号图一律不带箭头", () => {
  // 鱼骨图的主干和斜骨是折好的直线段，拐点按节点中心量；不带箭头
  const fish = (classes) => props("card", "LR", "poly", classes, ["curve-style", "edge-distances", "target-arrow-shape"], "fishbone");
  assert.deepEqual(fish("spine"), { "curve-style": "segments", "edge-distances": "node-position", "target-arrow-shape": "none" });
  assert.deepEqual(fish("rib"), { "curve-style": "segments", "edge-distances": "node-position", "target-arrow-shape": "none" });
  assert.ok(props("card", "TB", "poly", "spine", ["width"], "timeline")["width"] !== props("card", "TB", "poly", "spine", ["width"])["width"]);
  assert.equal(props("card", "LR", "poly", "", ["target-arrow-shape"], "brace")["target-arrow-shape"], "none");
  // 逻辑图不该被误伤
  assert.equal(props("card", "LR", "poly", "", ["target-arrow-shape"])["target-arrow-shape"], "triangle");
});

test("概要线两头接在锚点中心，箭头关掉", () => {
  // 必须是 inside-to-node。"50% 50%" 是「从中心偏出去半个节点」，括号两头会歪、下端多出一截
  const s = props("card", "LR", "poly", "summary", ["source-endpoint", "target-endpoint", "target-arrow-shape", "source-arrow-shape"]);
  assert.equal(s["source-endpoint"], "inside-to-node");
  assert.equal(s["target-endpoint"], "inside-to-node");
  assert.equal(s["target-arrow-shape"], "none");
  assert.equal(s["source-arrow-shape"], "none");
});

test("锚点本身看不见、不能拖", () => {
  const cy = cytoscape({
    headless: true,
    styleEnabled: true,
    warnings: false,
    elements: [{ data: { id: "a" }, classes: "summary-anchor" }],
    style: styleFor("card", "LR", "sans-serif", "poly"),
  });
  const a = cy.getElementById("a");
  const snap = {
    width: a.style("width"),
    padding: a.style("padding"),
    opacity: a.style("background-opacity"),
    border: a.style("border-width"),
    events: a.style("events"),
  };
  cy.destroy();
  // padding 必须清零：通用节点有 14 的 padding，带着它锚点就不是一个点了
  assert.deepEqual(snap, { width: "1px", padding: "0px", opacity: "0", border: "0px", events: "no" });
});

test("弧线的控制点按节点中心量；同一父节点的折线在同一处拐弯", () => {
  assert.equal(props("card", "LR", "curve", "", ["edge-distances"])["edge-distances"], "node-position");
  assert.equal(props("card", "LR", "poly", "elbow", ["taxi-turn"])["taxi-turn"], "20px");
});

/** 一个节点在某套主题里最终的字色 */
function textColor(theme, classes) {
  const cy = cytoscape({
    headless: true,
    styleEnabled: true,
    warnings: false,
    elements: [{ data: { id: "a", label: "甲" }, classes }],
    style: styleFor(theme, "LR", "sans-serif", "poly"),
  });
  const c = cy.getElementById("a").style("color");
  cy.destroy();
  return c;
}
/** #rrggbb 转成 cytoscape 返回的 rgb(...) 写法 */
const rgbOf = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255})`;
};

test("带网址的节点字用主题的强调色；起点节点自己就是强调色的底，字色不变", () => {
  const norm = (c) => c.replace(/\s/g, "");
  // 普通主题：强调色是起点底色（渐变取第一个色）
  assert.equal(norm(textColor("card", "link")), rgbOf("#2f6bff"));
  assert.equal(norm(textColor("aurora", "link")), rgbOf("#7c5cff"));
  // 没带网址的不受影响
  assert.equal(norm(textColor("card", "")), rgbOf(THEMES.card.node.text));
  // 起点：底色就是强调色，字保持原来的字色（卡片主题的起点是白字）
  assert.equal(norm(textColor("card", "root link")), rgbOf(THEMES.card.root.text));
  assert.equal(norm(textColor("aurora", "root link")), rgbOf(THEMES.aurora.root.text));
  // 终点：按自己的底色判断，卡片主题的终点是白底，用强调色
  assert.equal(norm(textColor("card", "end link")), rgbOf("#2f6bff"));
  // 强调色落在节点底色上看不清（黄色重点主题：黄字白底）时，不改字色
  assert.equal(norm(textColor("yellow", "link")), rgbOf(THEMES.yellow.node.text));
});

test("导出网页跟系统深浅色：按画布底色分深浅，不一致就换成浅色卡片或深色", () => {
  const dark = Object.keys(THEMES).filter((k) => isDarkTheme(k)).sort();
  assert.deepEqual(dark, ["aurora", "dark", "neon", "night", "pine"]);
  assert.equal(themeForMode("mint", false), "mint");
  assert.equal(themeForMode("neon", true), "neon");
  assert.equal(themeForMode("mint", true), "dark");
  assert.equal(themeForMode("aurora", false), "card");
  assert.equal(themeForMode("不存在的主题", false), "card");
  assert.equal(themeForMode("不存在的主题", true), "dark");
});
