import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// 侧栏的刷新决策是纯函数，抽出来单独测：这块在 Obsidian 里只能靠手点，测不了。
const out = join(mkdtempSync(join(tmpdir(), "outline-flow-side-")), "side.mjs");
buildSync({ entryPoints: ["src/side.ts"], bundle: true, format: "esm", outfile: out, logLevel: "error" });
const { OUTLINE, gate, pickDiagram } = await import(pathToFileURL(out).href);

const blocks = [
  { index: 0, source: "甲\n  乙", start: 2, end: 5 },
  { index: 1, source: "丙", start: 10, end: 12 },
];

const base = {
  path: "a.md",
  line: 3,
  lastPath: "a.md",
  lastLine: 3,
  shownKey: "k",
  dirty: false,
  wasHidden: false,
  visible: true,
};

test("光标没动、内容没改 → idle（600ms 轮询就停在这，不去扫全文）", () => {
  assert.equal(gate(base), "idle");
});

test("光标换了位置 → work", () => {
  assert.equal(gate({ ...base, line: 11 }), "work");
});

test("换了笔记 → work", () => {
  assert.equal(gate({ ...base, path: "b.md" }), "work");
});

test("内容改过 → work（光标没动也要重算）", () => {
  assert.equal(gate({ ...base, dirty: true }), "work");
});

test("侧栏收着 → hidden，不画；但没画过的那次不算，否则刚打开会一直空着", () => {
  assert.equal(gate({ ...base, visible: false }), "hidden");
  assert.equal(gate({ ...base, visible: false, shownKey: "" }), "work");
});

test("刚展开要补画 → work", () => {
  assert.equal(gate({ ...base, wasHidden: true }), "work");
});

test("光标在哪张图里就显示哪张", () => {
  assert.equal(pickDiagram("a.md", 3, "", 0, blocks, "").index, 0);
  assert.equal(pickDiagram("a.md", 11, "", 0, blocks, "").index, 1);
});

test("光标不在任何一张图里，就留在刚才那张", () => {
  // 光标挪到代码块外面（比如标题行），不该跳回第一张
  assert.equal(pickDiagram("a.md", 0, "a.md", 1, blocks, "").index, 1);
  // 换了笔记就不留了，从第一张开始
  assert.equal(pickDiagram("b.md", 0, "a.md", 1, blocks, "").index, 0);
});

test("留在刚才那张时索引越界要兜回第一张", () => {
  // 刚才在看第二张，但第二张被删了
  assert.equal(pickDiagram("a.md", 0, "a.md", 5, [blocks[0]], "").index, 0);
  // 刚才在整篇大纲模式（-1），现在有代码块了
  assert.equal(pickDiagram("a.md", 0, "a.md", OUTLINE, blocks, "").index, 0);
});

test("没有 flow 代码块 → 整篇大纲模式，id 沿用 __outline__", () => {
  const p = pickDiagram("a.md", 0, "a.md", 0, [], "- 甲\n- 乙");
  assert.equal(p.index, OUTLINE);
  assert.equal(p.diagramId, "__outline__"); // 不能变成 "-1"，已存的位置要对得上
  assert.equal(p.source, "- 甲\n- 乙");
});

test("内容变了 key 才变", () => {
  const a = pickDiagram("a.md", 3, "", 0, blocks, "");
  const b = pickDiagram("a.md", 3, "", 0, blocks, "");
  assert.equal(a.key, b.key);
  const changed = pickDiagram("a.md", 3, "", 0, [{ ...blocks[0], source: "甲\n  丙" }], "");
  assert.notEqual(a.key, changed.key);
});
