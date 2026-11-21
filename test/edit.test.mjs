import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// 图上改笔记的规则全是纯函数（src/edit.ts），先打成可以直接 import 的文件再测
const out = join(mkdtempSync(join(tmpdir(), "outline-flow-edit-")), "edit.mjs");
buildSync({ entryPoints: ["src/edit.ts"], bundle: true, format: "esm", outfile: out, logLevel: "error" });
const E = await import(pathToFileURL(out).href);
const g = join(mkdtempSync(join(tmpdir(), "outline-flow-edit-g-")), "graph.mjs");
buildSync({ entryPoints: ["src/graph.ts"], bundle: true, format: "esm", outfile: g, logLevel: "error" });
const G = await import(pathToFileURL(g).href);

const B = { mode: "block", index: 0 };
const O = { mode: "outline" };
const fence = (...lines) => ["```flow", ...lines, "```"].join("\n");
/** 笔记第几行（从 0 数） */
const at = (text, needle) => text.split("\n").findIndex((l) => l.includes(needle));
const ok = (r) => {
  assert.equal(r.ok, true, JSON.stringify(r));
  return r;
};
/** 改完的笔记里，被选中的那一行的内容 */
const picked = (r) => (r.line === null ? null : r.text.split("\n")[r.line]);

// ---------- 改字：代码块 ----------

const FLOW = fence("订单", "  下单【周一上线】", "    有货: 扣款", "    缺货：通知【要审批】", "  发货", "  } 两个");

test("改字：线上的字和【备注】原样留着，只换节点的字", () => {
  const r = ok(E.setNodeText(FLOW, B, at(FLOW, "扣款"), "扣钱"));
  assert.equal(r.text.split("\n")[at(FLOW, "扣款")], "    有货: 扣钱");
  const n = ok(E.setNodeText(FLOW, B, at(FLOW, "下单"), "提交订单"));
  assert.equal(n.text.split("\n")[at(FLOW, "下单")], "  提交订单【周一上线】");
  const f = ok(E.setNodeText(FLOW, B, at(FLOW, "通知"), "短信通知"));
  assert.equal(f.text.split("\n")[at(FLOW, "通知")], "    缺货：短信通知【要审批】", "全角冒号也是线上的字");
});

test("改字：编辑框里的原文不含线上的字，也不含【备注】", () => {
  assert.equal(E.rawNodeText(FLOW, B, at(FLOW, "扣款")), "扣款");
  assert.equal(E.rawNodeText(FLOW, B, at(FLOW, "下单")), "下单");
  assert.equal(E.rawNodeText(FLOW, B, at(FLOW, "通知")), "通知");
  assert.equal(E.rawNodeText(FLOW, B, 0), null, "围栏那行不是节点");
  assert.equal(E.rawNodeText(FLOW, B, at(FLOW, "}")), null, "概要不是能改的节点");
});

test("改字：字没变就是空操作，笔记原样不动", () => {
  const r = ok(E.setNodeText(FLOW, B, at(FLOW, "扣款"), "扣款"));
  assert.equal(r.text, FLOW);
  assert.equal(r.line, at(FLOW, "扣款"));
});

test("改字：空字不写；换行换成空格；前后空白去掉", () => {
  assert.equal(E.setNodeText(FLOW, B, at(FLOW, "扣款"), "   ").ok, false);
  const r = ok(E.setNodeText(FLOW, B, at(FLOW, "扣款"), "  扣\n款 "));
  assert.equal(r.text.split("\n")[at(FLOW, "扣款")], "    有货: 扣 款");
});

test("改字：最外层一行里的冒号是字，不是线上的字", () => {
  const t = fence("比例 1: 2", "  子");
  assert.equal(E.rawNodeText(t, B, 1), "比例 1: 2");
  assert.equal(ok(E.setNodeText(t, B, 1, "比例 3: 4")).text.split("\n")[1], "比例 3: 4");
});

test("改字：代码、链接、双链里的冒号不算线上的字", () => {
  const t = fence("根", "  命令 `a: b`", "  [说明: 细节](https://x.cn/a:b)", "  看 [[笔记: 名]]", "  线: 字 `c: d`");
  assert.equal(E.rawNodeText(t, B, 2), "命令 `a: b`");
  assert.equal(E.rawNodeText(t, B, 3), "[说明: 细节](https://x.cn/a:b)");
  assert.equal(E.rawNodeText(t, B, 4), "看 [[笔记: 名]]");
  assert.equal(E.rawNodeText(t, B, 5), "字 `c: d`");
  assert.equal(ok(E.setNodeText(t, B, 5, "新")).text.split("\n")[5], "  线: 新");
});

test("改字：原文里的 **加粗**、[[双链]]、网址照原样给，改完照原样写", () => {
  const t = fence("根", "  **重点** 见 [[笔记|别名]] https://a.cn/x");
  assert.equal(E.rawNodeText(t, B, 2), "**重点** 见 [[笔记|别名]] https://a.cn/x");
  assert.equal(ok(E.setNodeText(t, B, 2, "**新** [[乙]]")).text.split("\n")[2], "  **新** [[乙]]");
});

test("改字：代码块里的列表记号和任务框保留", () => {
  const t = fence("- 根", "  - [ ] 事项一", "  1. 第二条", "  - [x] 做完了【备注】");
  assert.equal(E.rawNodeText(t, B, 2), "事项一");
  assert.equal(ok(E.setNodeText(t, B, 2, "事项甲")).text.split("\n")[2], "  - [ ] 事项甲");
  assert.equal(ok(E.setNodeText(t, B, 3, "第二")).text.split("\n")[3], "  1. 第二");
  assert.equal(ok(E.setNodeText(t, B, 4, "完成")).text.split("\n")[4], "  - [x] 完成【备注】");
});

test("改字：Tab 缩进的代码块", () => {
  const t = fence("根", "\t子: 孙", "\t\t三");
  assert.equal(E.rawNodeText(t, B, 2), "孙");
  assert.equal(ok(E.setNodeText(t, B, 2, "新")).text.split("\n")[2], "\t子: 新");
});

test("改字：行上写了 {、(引用)、注释的不是节点，改不了", () => {
  const t = fence("根", "  容器 {", "  (根)", "  // 注释", "  普通");
  for (const n of [2, 3, 4]) assert.equal(E.rawNodeText(t, B, n), null);
  assert.equal(E.rawNodeText(t, B, 5), "普通");
  assert.equal(E.setNodeText(t, B, 3, "x").ok, false);
});

test("lineIsNode：哪些行是节点", () => {
  for (const l of ["根", "  - 子", "  线: 字", "  } 概要后面", "  普通 (带括号的字)"].slice(0, 3)) assert.equal(E.lineIsNode(l), true, l);
  assert.equal(E.lineIsNode("  普通 (带括号的字)"), true);
  for (const l of ["", "   ", "// x", "  } 两个", "  ｝", "  (扣款)", "  失败: (下单)", "  容器 {", "  /* x */"]) assert.equal(E.lineIsNode(l), false, l);
});

// ---------- 改字：整篇大纲 ----------

const NOTE = [
  "---",
  "title: 笔记",
  "---",
  "# 甲: 标题",
  "",
  "一段话。",
  "",
  "- a",
  "  - 线上的字: a1【备注】",
  "- b",
  "",
  "## 乙",
  "- c",
  "",
  "# 丙",
  "1. x",
  "2. y",
  "",
].join("\n");

test("整篇大纲：标题和列表项能取原文、能改，标题里的冒号是字，嵌套列表的冒号是线上的字", () => {
  assert.equal(E.rawNodeText(NOTE, O, at(NOTE, "# 甲")), "甲: 标题");
  assert.equal(E.rawNodeText(NOTE, O, at(NOTE, "a1")), "a1");
  assert.equal(E.rawNodeText(NOTE, O, at(NOTE, "一段话")), null, "段落不是节点");
  assert.equal(E.rawNodeText(NOTE, O, 0), null, "属性区不是节点");
  assert.equal(ok(E.setNodeText(NOTE, O, at(NOTE, "# 甲"), "新标题")).text.split("\n")[3], "# 新标题");
  assert.equal(ok(E.setNodeText(NOTE, O, at(NOTE, "a1"), "新")).text.split("\n")[8], "  - 线上的字: 新【备注】");
  assert.equal(ok(E.setNodeText(NOTE, O, at(NOTE, "- b"), "乙乙")).text.split("\n")[9], "- 乙乙");
});

test("整篇大纲：标题行尾的 # 和多个空格保留；段落和别的行一个字都不动", () => {
  const t = "##   小节 ##\n\n正文\n";
  assert.equal(E.rawNodeText(t, O, 0), "小节");
  assert.equal(ok(E.setNodeText(t, O, 0, "章")).text, "##   章 ##\n\n正文\n");
});

test("整篇大纲：没有上一级的列表项，冒号是字", () => {
  const t = "- 比例 1: 2\n- 乙\n";
  assert.equal(E.rawNodeText(t, O, 0), "比例 1: 2");
});

test("整篇大纲：围栏代码块里的 # 和 - 不是节点", () => {
  const t = "# 甲\n```bash\n# 注释\n- 不是列表\n```\n- 真列表\n";
  assert.equal(E.rawNodeText(t, O, 2), null);
  assert.equal(E.rawNodeText(t, O, 3), null);
  assert.equal(E.rawNodeText(t, O, 5), "真列表");
});

test("extractOutlineMap：和 extractOutlineFromMarkdown 的输出一模一样，另外给出每行对应笔记的哪一行", () => {
  for (const t of [NOTE, "# 甲\n```\n- x\n```\n- 真\n", "", "没有大纲\n", "# \n- a\n", "- a\n  - b\n\n# T\n- c"]) {
    assert.equal(G.extractOutlineMap(t).source, G.extractOutlineFromMarkdown(t));
  }
  const m = G.extractOutlineMap(NOTE);
  const lines = NOTE.split("\n");
  assert.equal(m.lines.length, m.source.split("\n").length);
  assert.deepEqual(
    m.lines.map((i) => lines[i]),
    ["# 甲: 标题", "- a", "  - 线上的字: a1【备注】", "- b", "## 乙", "- c", "# 丙", "1. x", "2. y"],
  );
  assert.deepEqual(G.extractOutlineMap("# \n- a\n").lines, [1], "没有字的标题整行丢掉，行号对应不错位");
});

// ---------- 同级（回车） ----------

test("同级：代码块里，放在节点整棵子树的后面，缩进和它一样", () => {
  const t = fence("订单", "  下单", "    校验", "    扣款", "  发货");
  const r = ok(E.addSibling(t, B, at(t, "下单"), "支付"));
  assert.deepEqual(r.text.split("\n").slice(1, 7), ["订单", "  下单", "    校验", "    扣款", "  支付", "  发货"]);
  assert.equal(picked(r), "  支付");
});

test("同级：最外层的节点再加一个最外层的", () => {
  const t = fence("甲", "  子", "乙");
  const r = ok(E.addSibling(t, B, 1, "新根"));
  assert.deepEqual(r.text.split("\n").slice(1, 5), ["甲", "  子", "新根", "乙"]);
});

test("同级：Tab 缩进的代码块用 Tab", () => {
  const t = fence("根", "\t甲", "\t\t甲一", "\t乙");
  const r = ok(E.addSibling(t, B, 2, "丙"));
  assert.deepEqual(r.text.split("\n").slice(1, 6), ["根", "\t甲", "\t\t甲一", "\t丙", "\t乙"]);
});

test("同级：代码块里带记号的行，新行沿用记号；编号加一；任务框给没勾的", () => {
  const t = fence("- 根", "  1. 第一", "  * 星号", "  - [x] 勾了");
  assert.equal(ok(E.addSibling(t, B, 2, "n")).text.split("\n")[3], "  2. n");
  assert.equal(ok(E.addSibling(t, B, 3, "n")).text.split("\n")[4], "  * n");
  assert.equal(ok(E.addSibling(t, B, 4, "n")).text.split("\n")[5], "  - [ ] n");
  assert.equal(ok(E.addSibling(fence("1) 甲"), B, 1, "乙")).text.split("\n")[2], "2) 乙");
});

test("同级：只放在代码块里面，不会掉到围栏外面", () => {
  const t = fence("甲") + "\n后文";
  const r = ok(E.addSibling(t, B, 1, "乙"));
  assert.equal(r.text, fence("甲", "乙") + "\n后文");
});

test("同级：整篇大纲里的列表项", () => {
  const r = ok(E.addSibling(NOTE, O, at(NOTE, "- a"), "新"));
  const lines = r.text.split("\n");
  assert.deepEqual(lines.slice(7, 11), ["- a", "  - 线上的字: a1【备注】", "- 新", "- b"]);
  assert.equal(picked(r), "- 新");
  // 嵌套的：缩进和它一样
  const n = ok(E.addSibling(NOTE, O, at(NOTE, "a1"), "新"));
  assert.equal(n.text.split("\n")[9], "  - 新");
});

test("同级：整篇大纲里编号列表，下一个号；任务框", () => {
  const r = ok(E.addSibling(NOTE, O, at(NOTE, "1. x"), "z"));
  assert.deepEqual(r.text.split("\n").slice(15, 18), ["1. x", "2. z", "2. y"]);
  const t = "# 清单\n- [ ] 买菜\n- [x] 做饭\n";
  assert.equal(ok(E.addSibling(t, O, 2, "洗碗")).text, "# 清单\n- [ ] 买菜\n- [x] 做饭\n- [ ] 洗碗\n");
});

test("同级：标题放在整节的后面（含小标题），前面补空行", () => {
  const r = ok(E.addSibling(NOTE, O, at(NOTE, "# 甲"), "丁"));
  const lines = r.text.split("\n");
  assert.deepEqual(lines.slice(12, 18), ["- c", "", "# 丁", "", "# 丙", "1. x"]);
  assert.equal(picked(r), "# 丁");
  // 小标题：同级的二级标题，放在乙这一节后面
  const s = ok(E.addSibling(NOTE, O, at(NOTE, "## 乙"), "丁二"));
  assert.deepEqual(s.text.split("\n").slice(11, 16), ["## 乙", "- c", "", "## 丁二", ""]);
});

test("同级：标题后面紧跟着下一个标题时也补空行；文末的标题", () => {
  assert.equal(ok(E.addSibling("# 甲\n# 乙\n", O, 0, "丙")).text, "# 甲\n\n# 丙\n# 乙\n");
  assert.equal(ok(E.addSibling("# 甲\n正文\n", O, 0, "乙")).text, "# 甲\n正文\n\n# 乙\n");
  assert.equal(ok(E.addSibling("# 甲", O, 0, "乙")).text, "# 甲\n\n# 乙");
});

// ---------- 下级（Tab） ----------

test("下级：代码块里放在所有子节点的最后，缩进跟着已有的子节点", () => {
  const t = fence("订单", "  下单", "    校验", "    扣款", "  发货");
  const r = ok(E.addChild(t, B, at(t, "下单"), "新"));
  assert.deepEqual(r.text.split("\n").slice(1, 7), ["订单", "  下单", "    校验", "    扣款", "    新", "  发货"]);
  assert.equal(picked(r), "    新");
});

test("下级：没有子节点时，缩进多一级（按块里已有的缩进步长，默认 2 格）", () => {
  const t = fence("订单", "    下单", "    发货");
  const r = ok(E.addChild(t, B, at(t, "下单"), "新"));
  assert.equal(r.text.split("\n")[3], "        新", "块里最小的缩进步长是 4");
  const d = ok(E.addChild(fence("甲"), B, 1, "新"));
  assert.equal(d.text.split("\n")[2], "  新", "没有别的参照，2 格");
});

test("下级：Tab 缩进的块用 Tab", () => {
  const t = fence("根", "\t甲", "\t乙");
  assert.equal(ok(E.addChild(t, B, 2, "新")).text.split("\n")[3], "\t\t新");
});

test("下级：代码块里带记号的行", () => {
  const t = fence("- 根", "  - 甲");
  assert.equal(ok(E.addChild(t, B, 1, "新")).text.split("\n")[3], "  - 新");
  assert.equal(ok(E.addChild(fence("1. 根"), B, 1, "新")).text.split("\n")[2], "  - 新", "编号的下一级用圆点");
});

test("下级：整篇大纲里的列表项，放在子树最后", () => {
  const r = ok(E.addChild(NOTE, O, at(NOTE, "- a"), "新"));
  assert.deepEqual(r.text.split("\n").slice(7, 11), ["- a", "  - 线上的字: a1【备注】", "  - 新", "- b"]);
  assert.equal(picked(r), "  - 新");
  const leaf = ok(E.addChild(NOTE, O, at(NOTE, "- b"), "新"));
  assert.deepEqual(leaf.text.split("\n").slice(9, 12), ["- b", "  - 新", ""]);
});

test("下级：整篇大纲里没有子项时，缩进按已有的写法（Tab 就用 Tab）", () => {
  const t = "# 甲\n- a\n\t- a1\n- b\n";
  assert.equal(ok(E.addChild(t, O, 3, "新")).text.split("\n")[4], "\t- 新");
  const s = "# 甲\n- a\n    - a1\n- b\n";
  assert.equal(ok(E.addChild(s, O, 3, "新")).text.split("\n")[4], "    - 新");
  const n = "# 甲\n1. a\n2. b\n";
  assert.equal(ok(E.addChild(n, O, 1, "新")).text.split("\n")[2], "   - 新", "编号记号宽 3，子项要缩进 3 格才算下一级");
});

test("下级：标题下面没有列表时，补一个空行再写 - 项", () => {
  const t = "# 甲\n\n一段话。\n\n# 乙\n";
  const r = ok(E.addChild(t, O, 0, "新"));
  assert.equal(r.text, "# 甲\n\n一段话。\n\n- 新\n\n# 乙\n");
  assert.equal(picked(r), "- 新");
  const tight = "# 甲\n一段话。\n# 乙\n";
  assert.equal(ok(E.addChild(tight, O, 0, "新")).text, "# 甲\n一段话。\n\n- 新\n# 乙\n");
  const empty = "# 甲\n# 乙\n";
  assert.equal(ok(E.addChild(empty, O, 0, "新")).text, "# 甲\n\n- 新\n# 乙\n");
});

test("下级：标题下已有列表时接在列表后面（不补空行），在第一个小标题之前", () => {
  const r = ok(E.addChild(NOTE, O, at(NOTE, "# 甲"), "新"));
  const lines = r.text.split("\n");
  assert.deepEqual(lines.slice(7, 13), ["- a", "  - 线上的字: a1【备注】", "- b", "- 新", "", "## 乙"]);
  assert.equal(picked(r), "- 新");
  const num = ok(E.addChild(NOTE, O, at(NOTE, "# 丙"), "z"));
  assert.deepEqual(num.text.split("\n").slice(15, 19), ["1. x", "2. y", "3. z", ""]);
});

test("下级：文末的标题", () => {
  assert.equal(ok(E.addChild("# 甲", O, 0, "新")).text, "# 甲\n\n- 新");
  assert.equal(ok(E.addChild("# 甲\n", O, 0, "新")).text, "# 甲\n\n- 新\n");
});

// ---------- 提一级（Shift+Tab） ----------

test("提一级：节点连同子树，变成上一级后面的同级，缩进少一级", () => {
  const t = fence("根", "  甲", "    乙", "      乙一", "      乙二", "    丙", "  丁");
  const r = ok(E.promote(t, B, at(t, "乙")));
  assert.deepEqual(r.text.split("\n").slice(1, 8), ["根", "  甲", "    丙", "  乙", "    乙一", "    乙二", "  丁"]);
  assert.equal(picked(r), "  乙");
});

test("提一级：上一级的子树里排在它后面的兄弟留在原处", () => {
  const t = fence("根", "  甲", "    乙", "    丙");
  const r = ok(E.promote(t, B, at(t, "乙")));
  assert.deepEqual(r.text.split("\n").slice(1, 5), ["根", "  甲", "    丙", "  乙"]);
});

test("提一级：Tab 缩进的块", () => {
  const t = fence("根", "\t甲", "\t\t乙", "\t\t\t乙一");
  const r = ok(E.promote(t, B, 3));
  assert.deepEqual(r.text.split("\n").slice(1, 5), ["根", "\t甲", "\t乙", "\t\t乙一"]);
});

test("提一级：最外层的节点提不了", () => {
  const t = fence("根", "  甲");
  const r = E.promote(t, B, 1);
  assert.deepEqual(r, { ok: false, reason: "已经是最上面一级了" });
});

test("提一级：整篇大纲里列表项的子树一起搬，缩进一起少一级", () => {
  const t = "# 甲\n- a\n  - b\n    - b1\n      续行\n    - b2\n  - c\n- d\n";
  const r = ok(E.promote(t, O, 2));
  assert.equal(r.text, "# 甲\n- a\n  - c\n- b\n  - b1\n    续行\n  - b2\n- d\n");
  assert.equal(picked(r), "- b");
});

test("提一级：Tab 缩进的列表", () => {
  const t = "- a\n\t- b\n\t\t- b1\n";
  assert.equal(ok(E.promote(t, O, 1)).text, "- a\n- b\n\t- b1\n");
});

test("提一级：标题下直接的列表项、标题本身、最外层列表项都不行", () => {
  assert.deepEqual(E.promote(NOTE, O, at(NOTE, "- a")), { ok: false, reason: "已经是最上面一级了" });
  assert.deepEqual(E.promote("- a\n- b\n", O, 1), { ok: false, reason: "已经是最上面一级了" });
  assert.equal(E.promote(NOTE, O, at(NOTE, "## 乙")).ok, false);
  assert.equal(E.promote(NOTE, O, at(NOTE, "# 甲")).ok, false);
});

// ---------- 删除 ----------

test("删除：连同整棵子树，多行的也一起；选中后一个同级", () => {
  const t = fence("根", "  甲", "    甲一", "    甲二", "  乙", "  丙");
  const r = ok(E.removeNode(t, B, at(t, "甲")));
  assert.deepEqual(r.text.split("\n").slice(1, 4), ["根", "  乙", "  丙"]);
  assert.equal(picked(r), "  乙");
});

test("删除：没有后一个同级就选前一个，再没有就选上一级", () => {
  const t = fence("根", "  甲", "  乙", "    乙一");
  const last = ok(E.removeNode(t, B, at(t, "乙")));
  assert.equal(picked(last), "  甲");
  const only = ok(E.removeNode(t, B, at(t, "乙一")));
  assert.equal(picked(only), "  乙");
  const root = ok(E.removeNode(fence("根"), B, 1));
  assert.equal(root.line, null);
  assert.equal(root.text, fence());
});

test("删除：概要行和注释行不是节点，删它上面的节点不会连带吃掉别的行", () => {
  const t = fence("订单", "  下单", "    子", "  发货", "  } 两个");
  const r = ok(E.removeNode(t, B, at(t, "下单")));
  assert.deepEqual(r.text.split("\n").slice(1, 4), ["订单", "  发货", "  } 两个"]);
});

test("删除：整篇大纲里的列表项连同缩进的下一级和续行", () => {
  const t = "# 甲\n- a\n  - a1\n    续行\n- b\n\n正文\n";
  const r = ok(E.removeNode(t, O, 1));
  assert.equal(r.text, "# 甲\n- b\n\n正文\n");
  assert.equal(picked(r), "- b");
  const b = ok(E.removeNode(t, O, 4));
  assert.equal(b.text, "# 甲\n- a\n  - a1\n    续行\n\n正文\n");
  assert.equal(picked(b), "- a");
});

test("删除：整篇大纲里的标题删掉整节，给提示", () => {
  const r = ok(E.removeNode(NOTE, O, at(NOTE, "# 甲")));
  assert.equal(r.text, ["---", "title: 笔记", "---", "# 丙", "1. x", "2. y", ""].join("\n"));
  assert.equal(r.notice, "删掉了整节，⌘Z 可以撤回");
  assert.equal(picked(r), "# 丙");
  const sub = ok(E.removeNode(NOTE, O, at(NOTE, "## 乙")));
  assert.deepEqual(sub.text.split("\n").slice(9, 14), ["- b", "", "# 丙", "1. x", "2. y"]);
  assert.equal(picked(sub), "- b", "二级标题没有后一个同级，选前一个：甲下面的最后一项");
});

test("删除：文末的标题，前面隔开的空行一起去掉；列表项删除没有提示", () => {
  const r = ok(E.removeNode("# 甲\n- a\n\n# 乙\n正文\n", O, 3));
  assert.equal(r.text, "# 甲\n- a\n");
  assert.equal(picked(r), "# 甲");
  assert.equal(ok(E.removeNode("# 甲\n- a\n", O, 1)).notice, undefined);
});

test("删除：编号列表", () => {
  const r = ok(E.removeNode(NOTE, O, at(NOTE, "1. x")));
  assert.deepEqual(r.text.split("\n").slice(14, 17), ["# 丙", "2. y", ""]);
  assert.equal(picked(r), "2. y");
});

// ---------- 换行符 ----------

test("换行符：整篇是 \\r\\n 的话，改完仍是 \\r\\n", () => {
  const t = "# 甲\r\n- a\r\n- b\r\n";
  const r = ok(E.addSibling(t, O, 1, "新"));
  assert.equal(r.text, "# 甲\r\n- a\r\n- 新\r\n- b\r\n");
  assert.equal(ok(E.setNodeText(t, O, 1, "A")).text, "# 甲\r\n- A\r\n- b\r\n");
  assert.equal(E.rawNodeText(t, O, 2), "b");
});

// ---------- 图上的操作落到笔记 ----------

test("applyEdit：图上的行号（从 1 数）对回笔记的行，并给出改完以后要选中的那行在新图里的行号", () => {
  const ds = E.diagramSource(NOTE, O);
  const srcLine = ds.lines.indexOf(at(NOTE, "- b")) + 1;
  const r = E.applyEdit(NOTE, O, ds.source, { kind: "addSibling", line: srcLine, text: "新" });
  assert.equal(r.ok, true);
  assert.equal(picked(r), "- 新");
  assert.equal(r.source.split("\n")[r.srcLine - 1].trim(), "- 新");
  assert.equal(r.source, G.extractOutlineFromMarkdown(r.text));
});

test("applyEdit：代码块", () => {
  const t = "前言\n" + FLOW + "\n";
  const src = E.diagramSource(t, B).source;
  assert.equal(src, ["订单", "  下单【周一上线】", "    有货: 扣款", "    缺货：通知【要审批】", "  发货", "  } 两个"].join("\n"));
  const r = E.applyEdit(t, B, src, { kind: "setText", line: 3, text: "扣钱" });
  assert.equal(r.ok, true);
  assert.equal(r.text.split("\n")[4], "    有货: 扣钱");
  assert.equal(r.srcLine, 3);
  const d = E.applyEdit(t, B, src, { kind: "remove", line: 2 });
  assert.equal(d.srcLine, 5 - 3, "删掉下单整棵子树（3 行）后，发货是第 2 行");
});

test("applyEdit：图的源文本和笔记现在的内容对不上，不动手", () => {
  const src = E.diagramSource(NOTE, O).source;
  const changed = NOTE.replace("- a", "- 被别处改了");
  const r = E.applyEdit(changed, O, src, { kind: "remove", line: 2 });
  assert.equal(r.ok, false);
  assert.match(r.reason, /笔记刚刚变了/);
  assert.equal(E.readNodeText(changed, O, src, 2), null);
  assert.equal(E.readNodeText(NOTE, O, src, 1), "甲: 标题");
});

test("applyEdit：行号越界、不是节点都给原因，不抛异常", () => {
  const t = fence("根", "  // 注释", "  子");
  const src = E.diagramSource(t, B).source;
  assert.equal(E.applyEdit(t, B, src, { kind: "remove", line: 2 }).ok, false);
  assert.equal(E.applyEdit(t, B, src, { kind: "remove", line: 99 }).ok, false);
  assert.equal(E.applyEdit(t, { mode: "block", index: 3 }, src, { kind: "remove", line: 1 }).ok, false);
});

test("applyEdit：第二个代码块只改第二个", () => {
  const t = fence("甲", "  乙") + "\n\n" + fence("丙", "  丁");
  const T = { mode: "block", index: 1 };
  const src = E.diagramSource(t, T).source;
  assert.equal(src, "丙\n  丁");
  const r = E.applyEdit(t, T, src, { kind: "addChild", line: 1, text: "戊" });
  assert.equal(r.text, fence("甲", "  乙") + "\n\n" + fence("丙", "  丁", "  戊"));
});

test("targetOf：图 id 对回来源", () => {
  assert.deepEqual(E.targetOf("__outline__"), { mode: "outline" });
  assert.deepEqual(E.targetOf("2"), { mode: "block", index: 2 });
});

// ---------- 小工具 ----------

test("diffRange：两段文字之间最小的一处改动", () => {
  assert.deepEqual(E.diffRange("abcdef", "abXdef"), { from: 2, to: 3, insert: "X" });
  assert.deepEqual(E.diffRange("abc", "abcd"), { from: 3, to: 3, insert: "d" });
  assert.deepEqual(E.diffRange("abcd", "ad"), { from: 1, to: 3, insert: "" });
  assert.deepEqual(E.diffRange("same", "same"), { from: 4, to: 4, insert: "" });
  const a = "一二三四";
  const b = "一二X三四";
  const d = E.diffRange(a, b);
  assert.equal(a.slice(0, d.from) + d.insert + a.slice(d.to), b);
  // 重复的字不会让前后缀重叠
  const r = E.diffRange("aaa", "aa");
  assert.equal("aaa".slice(0, r.from) + r.insert + "aaa".slice(r.to), "aa");
});

test("sourceTree：按缩进理出上一级和同级，方向键用", () => {
  const src = "根\n  甲\n    甲一\n    甲二\n  乙\n  } 两个\n丙";
  const t = E.sourceTree(src, [1, 2, 3, 4, 5, 7]);
  assert.deepEqual(t.get(1), { parent: null, prev: null, next: 7, first: 2 });
  assert.deepEqual(t.get(2), { parent: 1, prev: null, next: 5, first: 3 });
  assert.deepEqual(t.get(4), { parent: 2, prev: 3, next: null, first: null });
  assert.deepEqual(t.get(5), { parent: 1, prev: 2, next: null, first: null });
  assert.deepEqual(t.get(7), { parent: null, prev: 1, next: null, first: null });
});

test("sourceTree：有 # 标题的代码块按标题重排层级", () => {
  const t = E.sourceTree("# 甲\n- a\n## 乙\n- b", [1, 2, 3, 4]);
  assert.equal(t.get(2).parent, 1);
  assert.equal(t.get(3).parent, 1);
  assert.equal(t.get(4).parent, 3);
});

test("代码块里有 # 标题：只能改字，别的操作不动手", () => {
  const t = fence("# 甲", "- a");
  assert.equal(ok(E.setNodeText(t, B, 1, "乙")).text.split("\n")[1], "# 乙");
  assert.equal(E.addSibling(t, B, 2, "x").ok, false);
  assert.equal(E.addChild(t, B, 2, "x").ok, false);
  assert.equal(E.promote(t, B, 2).ok, false);
  assert.equal(E.removeNode(t, B, 2).ok, false);
});

test("上移下移：代码块里连同子树和同级换位置", () => {
  const text = fence("根", "  甲", "    甲一", "  乙", "    乙一", "  丙");
  const r = ok(E.moveNode(text, B, at(text, "乙"), -1));
  assert.equal(r.text, fence("根", "  乙", "    乙一", "  甲", "    甲一", "  丙"));
  assert.equal(r.line, at(r.text, "  乙"));
  const d = ok(E.moveNode(text, B, at(text, "  甲"), 1));
  assert.equal(d.text, fence("根", "  乙", "    乙一", "  甲", "    甲一", "  丙"));
  assert.equal(d.line, at(d.text, "  甲"));
  assert.equal(E.moveNode(text, B, at(text, "  甲"), -1).ok, false, "第一个不能再上移");
  assert.equal(E.moveNode(text, B, at(text, "丙"), 1).ok, false, "最后一个不能再下移");
});

test("上移下移：整篇大纲里列表项和标题节各自换，中间的空行留在原处", () => {
  const text = "# 根\n\n## 甲\n- 甲一\n\n## 乙\n- 乙一\n- 乙二\n";
  const r = ok(E.moveNode(text, O, at(text, "## 乙"), -1));
  assert.equal(r.text, "# 根\n\n## 乙\n- 乙一\n- 乙二\n\n## 甲\n- 甲一\n");
  const l = ok(E.moveNode(text, O, at(text, "乙二"), -1));
  assert.equal(l.text, "# 根\n\n## 甲\n- 甲一\n\n## 乙\n- 乙二\n- 乙一\n");
});
