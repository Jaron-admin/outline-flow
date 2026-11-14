import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// 先把 TypeScript 源码打成一个可以直接 import 的文件（用 esbuild API，Windows 下 spawn .bin/esbuild 会 ENOENT）
const out = join(mkdtempSync(join(tmpdir(), "outline-flow-")), "graph.mjs");
buildSync({ entryPoints: ["src/graph.ts"], bundle: true, format: "esm", outfile: out, logLevel: "error" });
const { buildElements, findFlowBlocks, inlineMarkdown, stripListMarkers, toFlowchartFun, extractOutlineFromMarkdown, normalizeOutline } = await import(pathToFileURL(out).href);

const nodes = (els) => els.filter((e) => e.group === "nodes");
const edges = (els) => els.filter((e) => e.group === "edges");

test("缩进连线、冒号是线上的字、括号是引用", () => {
  const els = buildElements("下单\n  查库存\n    有货: 扣款\n    缺货: 通知\n      (扣款)\n");
  assert.deepEqual(nodes(els).map((n) => n.data.label), ["下单", "查库存", "扣款", "通知"]);
  assert.equal(edges(els).length, 4);
  assert.equal(edges(els).find((e) => e.data.label === "有货").classes, "main");
  const ref = edges(els).filter((e) => e.classes === "ref");
  assert.equal(ref.length, 1);
});

test("起点和终点", () => {
  const els = buildElements("下单\n  查库存\n    扣款\n      失败: (下单)\n    取消\n");
  const cls = Object.fromEntries(nodes(els).map((n) => [n.data.label, n.classes]));
  assert.equal(cls["下单"], "root"); // 回环连回来不影响它是起点
  assert.equal(cls["取消"], "end");
  assert.equal(cls["扣款"], ""); // 有线连出去，不算终点
});

test("横杠列表和纯缩进得到同一张图", () => {
  const plain = buildElements("下单\n  查库存\n    有货: 扣款\n    (下单)\n");
  const dash = buildElements("- 下单\n  - 查库存\n    - 有货: 扣款\n    - (下单)\n");
  const tabs = buildElements("- 下单\n\t- 查库存\n\t\t- 有货: 扣款\n\t\t- (下单)\n");
  const shape = (els) => els.map((e) => [e.group, e.data.label, e.data.source, e.data.target, e.classes, e.data.col, e.data.row]);
  assert.deepEqual(shape(dash), shape(plain));
  assert.deepEqual(shape(tabs), shape(plain));
});

test("去列表记号：数字、星号、任务框", () => {
  assert.equal(stripListMarkers("1. 甲\n  * 乙\n  - [ ] 丙\n  - [x] 丁"), "甲\n  乙\n  丙\n  丁");
  assert.equal(stripListMarkers("甲-乙\n  -5 度"), "甲-乙\n  -5 度"); // 不是列表记号的横杠不动
});

test("同名节点的位置键不重复", () => {
  const els = buildElements("开始\n  检查\n  检查\n");
  assert.deepEqual(nodes(els).map((n) => n.data.key), ["开始", "检查", "检查 #2"]);
});

test("复制给 Flowchart Fun：去横杠，Tab 变两个空格", () => {
  assert.equal(toFlowchartFun("- 下单\n\t- 查库存\n\t\t- 有货: 扣款\n"), "下单\n  查库存\n    有货: 扣款\n");
});

test("找出笔记里的 flow 代码块", () => {
  const note = ["# 标题", "```flow", "甲", "  乙", "```", "正文", "```js", "let a", "```", "~~~~flow", "丙", "~~~~", "```flow", "没写完"].join("\n");
  const blocks = findFlowBlocks(note);
  assert.deepEqual(blocks.map((b) => [b.index, b.source, b.start, b.end]), [
    [0, "甲\n  乙", 1, 4],
    [1, "丙", 9, 11],
    [2, "没写完", 12, 13], // 没有结尾围栏：一直算到笔记末尾
  ]);
});

test("主线排成一条直线，支线对齐在格子上", () => {
  const els = buildElements([
    "用户提交订单",
    "  检查库存",
    "    有货: 扣款",
    "      成功: 发货",
    "        确认收货",
    "      失败: (用户提交订单)",
    "    缺货: 通知用户",
    "      愿意等: 补货",
    "        (扣款)",
    "      不等了: 取消订单",
  ].join("\n"));
  const at = Object.fromEntries(nodes(els).map((n) => [n.data.label, [n.data.col, n.data.row]]));
  assert.deepEqual(at, {
    用户提交订单: [0, 0], 检查库存: [1, 0], 扣款: [2, 0], 发货: [3, 0], 确认收货: [4, 0], // 主线
    通知用户: [2, 1], 补货: [3, 1], 取消订单: [3, 2], // 支线：同一父节点的子节点都在同一列
  });
  const kind = Object.fromEntries(edges(els).filter((e) => e.data.label).map((e) => [e.data.label, e.classes]));
  assert.deepEqual(kind, { 有货: "main", 成功: "main", 失败: "ref", 缺货: "elbow", 愿意等: "main", 不等了: "elbow" });
});

test("三个以上的分支往下排开，不互相挡住；多个起点各占一排", () => {
  const els = buildElements("甲\n  乙\n    乙一\n    乙二\n  丙\n  丁\n另一个起点\n");
  const at = Object.fromEntries(nodes(els).map((n) => [n.data.label, [n.data.col, n.data.row]]));
  assert.deepEqual(at, { 甲: [0, 0], 乙: [1, 0], 乙一: [2, 0], 乙二: [2, 1], 丙: [1, 2], 丁: [1, 3], 另一个起点: [0, 4] });
  const seen = new Set(Object.values(at).map(String));
  assert.equal(seen.size, 7); // 没有两个节点落在同一格
});

test("同一父节点的子节点都落在同一列（概要括号要靠这个才能贴住）", () => {
  // 两个子节点的情形曾经把第二个 drop 到父节点正下方，和第一个差了一列，
  // 概要花括号就只能斜着跨过去。这里守着它别再回去。
  const cols = (src) => {
    const els = buildElements(src);
    const groups = new Map();
    for (const e of els.filter((x) => x.group === "edges" && x.classes && x.classes !== "ref")) {
      if (!groups.has(e.data.source)) groups.set(e.data.source, []);
      groups.get(e.data.source).push(e.data.target);
    }
    const byId = new Map(nodes(els).map((n) => [n.data.id, n.data.col]));
    for (const targets of groups.values()) {
      const set = new Set(targets.map((t) => byId.get(t)));
      assert.equal(set.size, 1, `同一父节点的子节点分到了 ${[...set].join("、")} 列`);
    }
  };
  cols("A\n  B\n  C\n");
  cols("A\n  B\n  C\n  D\n");
  cols("项目\n  前端\n    Vue\n    React\n  后端\n    Java\n    Go\n");
});

test("备注从方括号里读出来，注释不进图", () => {
  const els = buildElements('下单 [note="周一前完成"] // 自己看的\n  查库存\n');
  assert.deepEqual(nodes(els).map((n) => [n.data.label, n.data.note]), [["下单", "周一前完成"], ["查库存", ""]]);
});

test("【】是备注：摘出成 note，不占节点文字", () => {
  const els = buildElements("- 仓库【先审批】\n  - 分支\n");
  assert.deepEqual(nodes(els).map((n) => [n.data.label, n.data.note]), [["仓库", "先审批"], ["分支", ""]]);
});

test("【】备注不影响缩进层级", () => {
  const NBSP_SP = "  ";
  const els = buildElements("- 上海\n" + NBSP_SP + "- 仓库\n" + NBSP_SP + "- 在线工具【不用申请】\n" + NBSP_SP + "- 账号\n");
  const ns = nodes(els);
  const rootId = ns.find((n) => n.data.label === "上海").data.id;
  const fromRoot = els.filter((e) => e.group === "edges" && e.data.source === rootId);
  assert.equal(fromRoot.length, 3, "三个子节点都该连到根，不能因为备注断成两半");
  assert.deepEqual(ns.map((n) => n.data.label), ["上海", "仓库", "在线工具", "账号"]);
});

test("全角括号是节点文字不是引用：自动转义后不报错", () => {
  const els = buildElements("- 仓库（含备用）\n  - 分支\n");
  assert.deepEqual(nodes(els).map((n) => n.data.label), ["仓库（含备用）", "分支"]);
  assert.equal(edges(els).length, 1);
});

test("手打过反斜杠的全角括号不会双重转义", () => {
  const els = buildElements("- 仓库\\（含备用\\）\n  - 分支\n");
  assert.deepEqual(nodes(els).map((n) => n.data.label), ["仓库（含备用）", "分支"]);
});

test("} 概要：是一个真节点，括住前面同一层的兄弟，和父节点之间不连线", () => {
  const els = buildElements("A\n  B\n  C\n  } 概要BC\n");
  const sums = els.filter((e) => e.group === "summaries");
  assert.equal(sums.length, 1);
  const labels = new Map(nodes(els).map((n) => [n.data.id, n.data.label]));
  assert.deepEqual(sums[0].data.ids.map((id) => labels.get(id)), ["B", "C"]);
  assert.equal(labels.get(sums[0].data.node), "概要BC");
  const sum = nodes(els).find((n) => n.data.label === "概要BC");
  assert.equal(sum.classes, "summary-node");
  // 括号已经说明它属于哪一组，不再从 A 拉一条线过去
  assert.deepEqual(edges(els).map((e) => labels.get(e.data.target)), ["B", "C"]);
});

test("概要排在被括子树最深一列的外面、垂直居中；内层概要把外层往外推", () => {
  const els = buildElements(
    ["项目", "  前端", "    Vue", "    React", "    } 两个框架", "  后端", "    Java", "    Go", "    } 两种语言", "  } 技术栈"].join("\n"),
  );
  const at = Object.fromEntries(nodes(els).map((n) => [n.data.label, [n.data.col, n.data.row]]));
  assert.deepEqual(at["两个框架"], [3, 0.5]);
  assert.deepEqual(at["两种语言"], [3, 2.5]);
  assert.deepEqual(at["技术栈"], [4, 1.5]); // 比两个内层概要再靠外一列
  const labels = new Map(nodes(els).map((n) => [n.data.id, n.data.label]));
  const outer = els.find((e) => e.group === "summaries" && labels.get(e.data.node) === "技术栈");
  // 括号罩住的是整棵子树，连内层的概要节点一起
  assert.deepEqual(outer.data.all.map((id) => labels.get(id)), ["前端", "Vue", "React", "两个框架", "后端", "Java", "Go", "两种语言"]);
});

test("连续两个 }：第二个只括上一个 } 之后的兄弟，不重叠", () => {
  const els = buildElements("A\n  B\n  C\n  } 前两个\n  D\n  E\n  } 再来\n");
  const labels = new Map(nodes(els).map((n) => [n.data.id, n.data.label]));
  const got = els.filter((e) => e.group === "summaries").map((s) => s.data.ids.map((id) => labels.get(id)).join("+"));
  assert.deepEqual(got, ["B+C", "D+E"]);
});

test("概要能接下一步；下一步太高时把后面的兄弟往下让", () => {
  const els = buildElements("发布\n  写稿\n  审稿\n  } 准备\n    进入发布\n    另一条\n    第三条\n  收尾\n");
  const labels = new Map(nodes(els).map((n) => [n.data.id, n.data.label]));
  assert.ok(edges(els).some((e) => labels.get(e.data.source) === "准备" && labels.get(e.data.target) === "进入发布"));
  const at = Object.fromEntries(nodes(els).map((n) => [n.data.label, [n.data.col, n.data.row]]));
  assert.deepEqual(at["准备"], [2, 0.5]);
  assert.deepEqual(at["第三条"], [3, 2.5]);
  assert.ok(at["收尾"][1] >= 3, "「收尾」没有往下让，会和概要的下一步叠在一起");
  const cells = new Set(Object.values(at).map(String));
  assert.equal(cells.size, Object.keys(at).length);
});

test("只写一个 } 也行：没有字，是个看不见的点", () => {
  const els = buildElements("A\n  B\n  C\n  }\n");
  assert.equal(els.filter((e) => e.group === "summaries").length, 1);
  const ghost = nodes(els).find((n) => n.classes.includes("ghost"));
  assert.equal(ghost.data.label, "");
});

test("最外层的几个起点也能括", () => {
  const els = buildElements("A\nB\n} 两个根\n");
  const labels = new Map(nodes(els).map((n) => [n.data.id, n.data.label]));
  assert.deepEqual(els.find((e) => e.group === "summaries").data.ids.map((id) => labels.get(id)), ["A", "B"]);
});

test("} 写错了要说出来，不能悄悄消失", () => {
  // 缩进比兄弟深了一格：它成了 C 的子节点，前面没有可括的
  const els = buildElements("A\n  B\n  C\n   } 概要\n");
  assert.equal(els.filter((e) => e.group === "summaries").length, 0);
  const w = els.filter((e) => e.group === "warnings");
  assert.equal(w.length, 1);
  assert.match(w[0].data.text, /第 4 行/);
  // 字还在图上，只是当成了普通节点
  assert.ok(nodes(els).some((n) => n.data.label === "概要" && !n.classes.includes("summary-node")));
});

test("「}文字」紧挨着的不是概要，节点不会被吞掉", () => {
  const els = buildElements("A\n  }不是概要\n");
  assert.equal(nodes(els).length, 2);
  assert.equal(els.filter((e) => e.group === "summaries").length, 0);
});

test("概要的字里有冒号是正文；【】照样是备注", () => {
  const els = buildElements("A\n  B\n  C\n  } 小结: 很重要【注意】\n");
  const sum = nodes(els).find((n) => n.classes.includes("summary-node"));
  assert.equal(sum.data.label, "小结: 很重要");
  assert.equal(sum.data.note, "注意");
});

test("graph-selector 自己的容器收尾 } 不当成概要", () => {
  const els = buildElements("A\n容器 {\n  B\n  C\n}\n");
  assert.equal(els.filter((e) => e.group === "summaries").length, 0);
  assert.equal(els.filter((e) => e.group === "warnings").length, 0);
});

test("思维导图：概要和它括的兄弟在同一侧，左侧的概要朝左", () => {
  const els = buildElements("中心\n  甲\n  乙\n  丙\n  丁\n  }:2 后两个\n", "mindmap");
  const at = Object.fromEntries(nodes(els).map((n) => [n.data.label, n.data.col]));
  assert.ok(at["甲"] > 0 && at["乙"] > 0);
  assert.ok(at["丙"] < 0 && at["丁"] < 0);
  assert.equal(at["后两个"], -2);
  assert.equal(els.find((e) => e.group === "summaries").data.side, "left");
});

test("时间轴、鱼骨图、发散图不画大括号：} 那一行不显示，并说明", () => {
  for (const st of ["timeline", "fishbone", "radial"]) {
    const els = buildElements("A\n  B\n  C\n  } 概要\n", st);
    assert.equal(els.filter((e) => e.group === "summaries").length, 0);
    assert.ok(!nodes(els).some((n) => n.data.label === "概要"), `${st} 里概要还在`);
    assert.equal(els.filter((e) => e.group === "warnings").length, 1);
  }
});

test("一行里写两个【】，两个都留着", () => {
  const els = buildElements("A【一】【二】\n");
  assert.equal(nodes(els)[0].data.note, "一；二");
  assert.equal(nodes(els)[0].data.label, "A");
});

test("}:N 只概括最后 N 个兄弟", () => {
  const els = buildElements("A\n  B\n  C\n  D\n  }:2 后两个\n");
  const sums = els.filter((e) => e.group === "summaries");
  const labels = new Map(nodes(els).map((n) => [n.data.id, n.data.label]));
  assert.deepEqual(sums[0].data.ids.map((id) => labels.get(id)), ["C", "D"]);
});

test("概要归属按缩进层级：深层节点后的同级概要不挂错父", () => {
  const els = buildElements("A\n  B\n    C\n  D\n  } 概要BD\n");
  const sums = els.filter((e) => e.group === "summaries");
  const labels = new Map(nodes(els).map((n) => [n.data.id, n.data.label]));
  // 概要行和 B、D 同缩进，应该概括 B 和 D，不能因为前一行是更深的 C 就挂到 B 底下
  assert.deepEqual(sums[0].data.ids.map((id) => labels.get(id)), ["B", "D"]);
});

test("只括一个兄弟也能画", () => {
  const els = buildElements("A\n  B\n  } 只有一个\n");
  const sums = els.filter((e) => e.group === "summaries");
  assert.equal(sums.length, 1);
  const labels = new Map(nodes(els).map((n) => [n.data.id, n.data.label]));
  assert.deepEqual(sums[0].data.ids.map((id) => labels.get(id)), ["B"]);
  assert.equal(labels.get(sums[0].data.node), "只有一个");
});

test("备注里的全角括号不加反斜杠（备注不走解析器，加了会原样显示）", () => {
  const els = buildElements("- 仓库【先找人确认（二级）】\n  - 分支\n");
  const n = nodes(els)[0];
  assert.equal(n.data.note, "先找人确认（二级）");
  assert.equal(n.data.label, "仓库");
});

test("复制给 Flowchart Fun：概要行转成注释，不会变成一个多出来的节点", () => {
  // flowchart.fun 的解析器不认 }，会把「概要BC」当成图上一个节点
  assert.equal(toFlowchartFun("- A\n  - B\n  - C\n  - } 概要BC\n"), "A\n  B\n  C\n  // 概要BC\n");
  assert.equal(toFlowchartFun("A\n  B\n  }:2\n"), "A\n  B\n  // 概要前 2 项\n");
  assert.equal(toFlowchartFun("A\n  B\n  }\n"), "A\n  B\n  // 概要\n");
});

test("概要行后面的节点备注不错位", () => {
  const els = buildElements("A\n  B\n  } 概要B\n  C【C的备注】\n");
  const c = nodes(els).find((n) => n.data.label === "C");
  assert.equal(c.data.note, "C的备注");
});

// ---------- 结构：同一份大纲按不同版式摆 ----------

const TREE = [
  "订单系统",
  "  下单",
  "    校验库存",
  "    生成订单",
  "  支付",
  "    微信支付",
  "    支付宝",
  "  发货",
  "    仓库拣货",
  "    物流揽收",
].join("\n");

const at = (src, structure) => Object.fromEntries(nodes(buildElements(src, structure)).map((n) => [n.data.label, [n.data.col, n.data.row]]));

test("组织结构图：根在最上，逐层往下，父节点落在子节点正中间", () => {
  const pos = at(TREE, "org");
  // 三棵子树各占两行，根因此落在 0.5 和 4.5 的中间
  assert.deepEqual(pos["订单系统"], [0, 2.5]);
  assert.deepEqual(pos["下单"], [1, 0.5]);
  assert.deepEqual(pos["支付"], [1, 2.5]);
  assert.deepEqual(pos["发货"], [1, 4.5]);
  // 叶子按顺序一路摞下去，父节点的 row 正好是自己两个叶子的中点
  assert.deepEqual(pos["校验库存"], [2, 0]);
  assert.deepEqual(pos["生成订单"], [2, 1]);
  assert.deepEqual(pos["物流揽收"], [2, 5]);
});

test("思维导图：中心节点在中间，第一层子节点分到左右两边，各自往外长", () => {
  const pos = at(TREE, "mindmap");
  assert.equal(pos["订单系统"][0], 0);
  const sides = ["下单", "支付", "发货"].map((k) => Math.sign(pos[k][0]));
  assert.ok(sides.includes(1) && sides.includes(-1), `子节点该分到两侧，实际 ${sides}`);
  // 左半边用负的 col，深层继续往外（-2）
  assert.equal(pos["仓库拣货"][0], -2);
  // 右边那半边的深层是正的
  assert.equal(pos["校验库存"][0], 2);
});

test("时间轴：事件在主轴上一根排开，各自的子项从上往下叠，不会挤在同一格", () => {
  const pos = at(TREE, "timeline");
  assert.deepEqual(["订单系统", "下单", "支付", "发货"].map((k) => pos[k]), [
    [0, 0],
    [0, 1],
    [0, 2],
    [0, 3],
  ]);
  // 子项和父节点同一排（同一个时间点），往下叠；以前两个子项都塞在 (col+1, row) 会完全重叠
  assert.deepEqual(pos["校验库存"], [1, 1]);
  assert.deepEqual(pos["生成订单"], [2, 1]);
  assert.deepEqual(pos["支付宝"], [2, 2]);
  const kind = Object.fromEntries(edges(buildElements(TREE, "timeline")).map((e) => [e.data.label || e.data.target, e.classes]));
  assert.ok(Object.values(kind).every((c) => c === "spine" || c === "mark"), "时间轴的线只该分主干和挂线两类");
});

test("鱼骨图：头、骨、骨底下按大纲顺序一行一个，骨一上一下", () => {
  const els = buildElements(TREE, "fishbone");
  const f = Object.fromEntries(nodes(els).map((n) => [n.data.label, n.data.fish]));
  assert.equal(f["订单系统"].role, "head");
  assert.deepEqual(["下单", "支付", "发货"].map((k) => [f[k].role, f[k].side]), [["bone", -1], ["bone", 1], ["bone", -1]]);
  assert.deepEqual([f["校验库存"].row, f["生成订单"].row], [0, 1]);
  const kind = new Set(edges(els).map((e) => e.classes));
  assert.ok(kind.has("spine") && kind.has("rib"));
});

test("括号图：普通连线去掉，每层配一把大括号", () => {
  const els = buildElements(TREE, "brace");
  assert.equal(edges(els).length, 0);
  const braces = els.filter((e) => e.group === "summaries");
  // 根一把（3 个子节点）+ 三个父节点各一把（各 2 个子节点）
  assert.equal(braces.length, 4);
  assert.ok(braces.every((b) => b.classes === "brace"), "括号图的括号要能和手写的 } 概要区分开");
  const labels = new Map(nodes(els).map((n) => [n.data.id, n.data.label]));
  const root = braces.find((b) => b.data.ids.length === 3);
  assert.deepEqual(root.data.ids.map((id) => labels.get(id)), ["下单", "支付", "发货"]);
  // 只有一个子节点的父节点不配括号，光是冗余
  assert.equal(braces.filter((b) => b.data.ids.length === 1).length, 0);
});

test("换结构不改解析结果：节点和备注一个不少", () => {
  const src = "- 仓库【先审批】\n  - 分支\n  - 在线工具\n";
  // 鱼骨图不用格子，坐标由 fish.ts 按尺寸算，它的不重叠在 curve.test.mjs 里单独测
  for (const s of ["trunk", "flow", "logic", "org", "mindmap", "brace", "timeline"]) {
    const ns = nodes(buildElements(src, s)).map((n) => n.data.label);
    assert.deepEqual(ns, ["仓库", "分支", "在线工具"], `${s} 把节点弄丢了`);
  }
});

test("每种结构都不会让两个节点落在同一格", () => {
  // 鱼骨图不用格子，坐标由 fish.ts 按尺寸算，它的不重叠在 curve.test.mjs 里单独测
  for (const s of ["trunk", "flow", "logic", "org", "mindmap", "brace", "timeline"]) {
    const pos = at(TREE, s);
    const cells = Object.values(pos).map(([c, r]) => c + "|" + r);
    assert.equal(new Set(cells).size, cells.length, `${s} 有两个节点重叠：${cells.join(" ")}`);
  }
});

// ---------- 这一轮加的：主干图、流程图、发散图、带数字的大括号 ----------

const SAMPLE = [
  "用户提交订单",
  "  检查库存",
  "    有货: 扣款",
  "      成功: 发货",
  "        确认收货",
  "      失败: (用户提交订单)",
  "    缺货: 通知用户",
  "      愿意等: 补货",
  "        (扣款)",
  "      不等了: 取消订单",
].join("\n");

test("主干图：正好两个子节点时，第二个落在父节点正下方，再接着往前走", () => {
  const els = buildElements(SAMPLE, "trunk");
  const at = Object.fromEntries(nodes(els).map((n) => [n.data.label, [n.data.col, n.data.row]]));
  assert.deepEqual(at, {
    用户提交订单: [0, 0], 检查库存: [1, 0], 扣款: [2, 0], 发货: [3, 0], 确认收货: [4, 0], // 主线是一条直线
    通知用户: [1, 1], 补货: [2, 1], // 支线从「检查库存」正下方分出去，再往前走
    取消订单: [1, 2],
  });
  const kind = Object.fromEntries(edges(els).filter((e) => e.data.label).map((e) => [e.data.label, e.classes]));
  assert.deepEqual(kind, { 有货: "main", 成功: "main", 失败: "ref", 缺货: "drop", 愿意等: "main", 不等了: "drop" });
});

test("主干图：三个以上的分支还是往下一列排开，不会互相挡住", () => {
  const els = buildElements("甲\n  乙\n  丙\n  丁\n", "trunk");
  const at = Object.fromEntries(nodes(els).map((n) => [n.data.label, [n.data.col, n.data.row]]));
  assert.deepEqual(at, { 甲: [0, 0], 乙: [1, 0], 丙: [1, 1], 丁: [1, 2] });
});

test("主干图里概要照样罩得住正下方的那个分支", () => {
  const els = buildElements("A\n  B\n    B1\n  C\n  } 两个\n", "trunk");
  const at = Object.fromEntries(nodes(els).map((n) => [n.data.label, [n.data.col, n.data.row]]));
  assert.deepEqual(at["C"], [0, 1]); // 落在 A 正下方
  assert.deepEqual(at["两个"], [3, 0.5]); // 比最深的 B1（第 2 列）再靠外一列
});

test("逻辑图不受影响：分支一律去下一列", () => {
  const els = buildElements(SAMPLE, "logic");
  const at = Object.fromEntries(nodes(els).map((n) => [n.data.label, n.data.col]));
  assert.equal(at["通知用户"], 2);
  assert.ok(edges(els).every((e) => e.classes !== "drop"));
});

test("流程图：有两个以上去向的节点是判断", () => {
  const els = buildElements(SAMPLE, "flow");
  const decisions = nodes(els).filter((n) => n.classes.includes("decision")).map((n) => n.data.label);
  assert.deepEqual(decisions, ["检查库存", "通知用户"]);
  // 排法和主干图一样
  assert.ok(edges(els).some((e) => e.classes === "drop"));
});

test("发散图：中心在正中，子节点分到一整圈，一层一圈", () => {
  const els = buildElements("中心\n  甲\n    甲一\n    甲二\n  乙\n  丙\n", "radial");
  const polar = Object.fromEntries(nodes(els).map((n) => [n.data.label, n.data.polar]));
  assert.equal(polar["中心"].depth, 0);
  assert.deepEqual([polar["甲"].depth, polar["乙"].depth, polar["甲一"].depth], [1, 1, 2]);
  // 三个子节点的角度加起来正好一圈；甲底下有两片叶子，占一半
  const total = polar["甲"].span + polar["乙"].span + polar["丙"].span;
  assert.ok(Math.abs(total - Math.PI * 2) < 1e-9);
  assert.ok(Math.abs(polar["甲"].span - Math.PI) < 1e-9);
  // 子节点落在父节点那段角度里面
  assert.ok(Math.abs(polar["甲一"].angle - polar["甲"].angle) < polar["甲"].span / 2);
  assert.ok(edges(els).every((e) => e.classes === "ray"));
});

test("带数字的大括号：全角、带空格、数字后面紧跟字的写法都认", () => {
  for (const line of ["}:2 后两个", "}：2 后两个", "} : 2 后两个", "}: 2 后两个", "}:2后两个", "｝：2 后两个", "- }:2 后两个"]) {
    const els = buildElements("A\n  B\n  C\n  D\n  " + line + "\n");
    const labels = new Map(nodes(els).map((n) => [n.data.id, n.data.label]));
    const sum = els.find((e) => e.group === "summaries");
    assert.ok(sum, `「${line}」没有画出大括号`);
    assert.deepEqual(sum.data.ids.map((id) => labels.get(id)), ["C", "D"], `「${line}」括错了`);
    assert.equal(labels.get(sum.data.node), "后两个", `「${line}」的字不对`);
  }
  // 数字和字之间隔一个空格，也是「括几个」
  const four = buildElements("A\n  B\n  C\n  D\n  E\n  F\n  } 4 密测\n");
  const labels4 = new Map(nodes(four).map((n) => [n.data.id, n.data.label]));
  const sum4 = four.find((e) => e.group === "summaries");
  assert.deepEqual(sum4.data.ids.map((id) => labels4.get(id)), ["C", "D", "E", "F"]);
  assert.equal(labels4.get(sum4.data.node), "密测");
  // 数字紧挨着字，整串都是概要的字
  const els = buildElements("A\n  B\n  C\n  D\n  } 2个要点\n");
  assert.equal(els.find((e) => e.group === "summaries").data.ids.length, 3);
});

// ---------- # 标题当大纲层级 ----------

test("整篇笔记：# 标题是上一级，标题下面的列表挂在它底下，跳级也能接上", () => {
  const md = [
    "---", "tags: [计划]", "---",
    "# 项目计划",
    "随便写的一段话，不进图",
    "## 准备",
    "- 调研",
    "\t- 竞品",
    "- 立项",
    "#### 跳了一级",
    "```js", "# 代码块里的不算", "```",
    "## 上线",
    "#标签 不是标题",
  ].join("\n");
  assert.equal(
    extractOutlineFromMarkdown(md),
    ["项目计划", "  准备", "    - 调研", "      - 竞品", "    - 立项", "    跳了一级", "  上线"].join("\n"),
  );
});

test("flow 代码块里也认标题，行数不变，备注还对得上", () => {
  const out = normalizeOutline(["# 总", "## 分一", "叶【备注】", "## 分二"], true);
  assert.deepEqual(out, ["总", "  分一", "    叶【备注】", "  分二"]);
  const els = buildElements("# 总\n## 分一\n叶【备注】\n## 分二\n");
  const at = Object.fromEntries(nodes(els).map((n) => [n.data.label, n.data.note]));
  assert.deepEqual(Object.keys(at), ["总", "分一", "叶", "分二"]);
  assert.equal(at["叶"], "备注");
  assert.equal(edges(els).length, 3);
});

test("Markdown 行内写法：加粗、代码、链接图上显示成纯文字", () => {
  const els = buildElements("根\n  **测**：`curl -X POST http://127.0.0.1:1880/a -d '{\"t\":\"x\"}'`\n  **整行加粗**\n  看 [文档](https://x.y/z) 和 [[笔记名|别名]]\n  ~~删~~ ==亮== *斜*\n");
  const labels = nodes(els).map((n) => n.data.label);
  assert.deepEqual(labels, ["根", `curl -X POST http://127.0.0.1:1880/a -d '{"t":"x"}'`, "整行加粗", "看 文档 和 别名", "删 亮 斜"]);
  assert.equal(edges(els).find((e) => e.data.target === nodes(els)[1].data.id).data.label, "测");
  assert.ok(nodes(els)[2].classes.includes("strong"));
  assert.ok(!nodes(els)[1].classes.includes("strong"));
});

test("顶层冒号、句子里的半角括号直接当字，不报错", () => {
  const els = buildElements("开头: 没有上一级\n  双击 inject (300 = 5 分钟) 改成想要的\n  (正常)\n");
  assert.deepEqual(nodes(els).map((n) => n.data.label), ["开头: 没有上一级", "双击 inject (300 = 5 分钟) 改成想要的"]);
  assert.equal(els.filter((e) => e.group === "warnings").length, 0);
});

test("某一行读不通：整张图照样出来，那一行按原文显示，并说清是哪一行", () => {
  const els = buildElements("根\n  甲 #a\n  乙 #a\n  丙\n");
  assert.deepEqual(nodes(els).map((n) => n.data.label), ["根", "甲", "乙 #a", "丙"]);
  const w = els.filter((e) => e.group === "warnings");
  assert.equal(w.length, 1);
  assert.equal(w[0].data.find, "乙 #a");
  assert.match(w[0].data.text, /「乙 #a」这一行/);
  assert.equal(edges(els).length, 3);
});

test("标题里的冒号是标题的字", () => {
  const els = buildElements("# 总：说明\n## 分：一\n");
  assert.deepEqual(nodes(els).map((n) => n.data.label), ["总：说明", "分：一"]);
});

test("中文标签 #重要 原样显示，不吃掉后面的字", () => {
  const els = buildElements("根\n  任务 #重要 明天\n");
  assert.equal(nodes(els)[1].data.label, "任务 #重要 明天");
});

test("代码里的 \\n 不会被拆成换行", () => {
  const els = buildElements("根\n  装在 `C:\\Program Files\\nodejs`\n");
  assert.ok(!nodes(els)[1].data.label.includes("\n"));
});

// ---------- 网址：点节点能打开 ----------

const linksOf = (src) => inlineMarkdown(src).links;

test("网址：[字](地址)、<地址>、直接写的地址都记成链接", () => {
  assert.deepEqual(linksOf("看 [文档](https://x.y/z) 就行"), [{ kind: "url", text: "文档", url: "https://x.y/z" }]);
  assert.deepEqual(linksOf("写信 [我](mailto:a@b.cn)"), [{ kind: "url", text: "我", url: "mailto:a@b.cn" }]);
  assert.deepEqual(linksOf("官网 <https://nodered.org/docs>"), [{ kind: "url", text: "https://nodered.org/docs", url: "https://nodered.org/docs" }]);
  assert.deepEqual(linksOf("官网 https://nodered.org 很好用"), [{ kind: "url", text: "https://nodered.org", url: "https://nodered.org" }]);
  assert.deepEqual(linksOf("一个 http://a.cn 一个 https://b.cn"), [
    { kind: "url", text: "http://a.cn", url: "http://a.cn" },
    { kind: "url", text: "https://b.cn", url: "https://b.cn" },
  ]);
});

test("网址：直接写的地址到中文标点、空白就停，括号只在没配对时才不算", () => {
  const stop = (s) => linksOf(s).map((l) => l.url);
  assert.deepEqual(stop("见https://a.com/x，再说"), ["https://a.com/x"]);
  assert.deepEqual(stop("https://a.com/x。"), ["https://a.com/x"]);
  assert.deepEqual(stop("https://a.com/x；https://b.com/y、https://c.com/z"), ["https://a.com/x", "https://b.com/y", "https://c.com/z"]);
  assert.deepEqual(stop("（官网 https://a.com/x）"), ["https://a.com/x"]);
  assert.deepEqual(stop("「https://a.com/x」"), ["https://a.com/x"]);
  assert.deepEqual(stop("【https://a.com/x】"), ["https://a.com/x"]);
  assert.deepEqual(stop("(https://a.com/x)"), ["https://a.com/x"]);
  assert.deepEqual(stop("[https://a.com/x]"), ["https://a.com/x"]);
  assert.deepEqual(stop("见 https://a.com/x."), ["https://a.com/x"]);
  // 地址自己带的、配了对的括号要留着
  assert.deepEqual(stop("https://zh.wikipedia.org/wiki/A_(b)"), ["https://zh.wikipedia.org/wiki/A_(b)"]);
  assert.deepEqual(stop("(见 https://zh.wikipedia.org/wiki/A_(b))"), ["https://zh.wikipedia.org/wiki/A_(b)"]);
  // 加粗的记号不是地址的一部分
  assert.deepEqual(stop("**https://a.com/x**"), ["https://a.com/x"]);
});

test("网址：图片、嵌入、代码里的地址、相对路径都不是链接", () => {
  assert.deepEqual(linksOf("嵌入 ![[图.png]] 和 ![[笔记|别名]]"), []);
  assert.deepEqual(linksOf("图 ![说明](https://a.com/p.png)"), []);
  assert.deepEqual(linksOf("命令 `curl https://a.com/x`"), []);
  assert.deepEqual(linksOf("[本地](./a.md) [脚本](javascript:alert(1))"), []);
  assert.equal(inlineMarkdown("看 [[笔记名|别名]]").text, "看 别名");
});

test("网址：同一个地址写两次只记一次；链接字空着就用地址当字", () => {
  assert.deepEqual(linksOf("[甲](https://a.com) 和 https://a.com").map((l) => l.url), ["https://a.com"]);
  assert.deepEqual(linksOf("[](https://a.com)"), [{ kind: "url", text: "https://a.com", url: "https://a.com" }]);
});

test("网址里的 # 和 // 不会把节点文字截断", () => {
  const els = buildElements("根\n  https://a.com/p#top//x.html\n  官网: https://b.com/a?x=1#y\n  后面还有字\n");
  assert.deepEqual(nodes(els).map((n) => n.data.label), ["根", "https://a.com/p#top//x.html", "https://b.com/a?x=1#y", "后面还有字"]);
  assert.equal(els.filter((e) => e.group === "warnings").length, 0);
  assert.equal(edges(els).find((e) => e.data.target === nodes(els)[2].data.id).data.label, "官网");
  // 用 <地址> 写也一样
  const auto = buildElements("根\n  <https://a.com/p#top//x>\n");
  assert.equal(nodes(auto)[1].data.label, "https://a.com/p#top//x");
});

test("带网址的节点：有 link 类，data.links 记着地址；备注里的地址不算", () => {
  const els = buildElements("根\n  官网 [甲](https://a.com) [乙](https://b.com)\n  普通\n  带备注【见 https://n.com】\n");
  const [root, site, plain, noted] = nodes(els);
  assert.equal(site.classes.split(" ").includes("link"), true);
  assert.deepEqual(site.data.links, [
    { kind: "url", text: "甲", url: "https://a.com" },
    { kind: "url", text: "乙", url: "https://b.com" },
  ]);
  assert.equal(site.data.label, "官网 甲 乙");
  for (const n of [root, plain, noted]) {
    assert.equal(n.classes.split(" ").includes("link"), false);
    assert.equal(n.data.links, undefined);
  }
  // 起点、终点、整行加粗和 link 类并存
  const mixed = buildElements("**https://a.com**\n  https://b.com\n");
  assert.deepEqual(nodes(mixed).map((n) => n.classes), ["root strong link", "end link"]);
});

// ---------- 双链：Obsidian 的 [[笔记]] ----------

const wiki = (src) => linksOf(src).filter((l) => l.kind === "note");

test("双链：[[笔记]]、[[笔记|别名]]、[[笔记#标题]] 都记成 note 链接，字是别名或笔记名，url 是链接路径", () => {
  assert.deepEqual(linksOf("看 [[笔记名]]"), [{ kind: "note", text: "笔记名", url: "笔记名" }]);
  assert.deepEqual(linksOf("看 [[笔记名|别名]]"), [{ kind: "note", text: "别名", url: "笔记名" }]);
  assert.deepEqual(linksOf("看 [[笔记名#小节]]"), [{ kind: "note", text: "笔记名#小节", url: "笔记名#小节" }]);
  assert.deepEqual(linksOf("看 [[笔记名#小节|别名]]"), [{ kind: "note", text: "别名", url: "笔记名#小节" }]);
  assert.deepEqual(linksOf("看 [[ 带空格 | 别名 ]]"), [{ kind: "note", text: "别名", url: "带空格" }]);
  assert.deepEqual(linksOf("看 [[笔记名#^块]]").map((l) => l.url), ["笔记名#^块"]);
});

test("双链：![[嵌入]] 不算链接，图上只显示名字", () => {
  assert.deepEqual(wiki("![[图.png]]"), []);
  assert.deepEqual(wiki("![[笔记]] 和 [[另一篇]]").map((l) => l.url), ["另一篇"]);
  assert.equal(inlineMarkdown("![[图.png]]").text, "图\\.png", "点号按字面显示，所以带反斜杠转义");
});

test("双链：显示的字不变；和网址一起时各记各的；同一个双链写两次只记一次", () => {
  assert.equal(inlineMarkdown("看 [[笔记名|别名]]").text, "看 别名");
  const both = linksOf("[[甲]] 和 https://a.com 和 [[甲]] 和 [[甲|乙]]");
  assert.deepEqual(both.map((l) => l.kind + ":" + l.url), ["note:甲", "url:https://a.com"]);
  assert.deepEqual(wiki("代码里 `[[不是]]` 不算"), []);
});

test("双链：noteLinks 给 false 时（导出网页）只当普通文字，不记链接", () => {
  const r = inlineMarkdown("看 [[笔记名|别名]] 和 [甲](https://a.com)", false);
  assert.equal(r.text, "看 别名 和 甲");
  assert.deepEqual(r.links.map((l) => l.kind), ["url"]);
  const els = buildElements("根\n  去 [[笔记]]\n  官网 https://a.com\n", "logic", { noteLinks: false });
  const [, plain, web] = els.filter((e) => e.group === "nodes");
  assert.equal(plain.data.links, undefined);
  assert.equal(plain.classes.split(" ").includes("link"), false, "没有链接色");
  assert.equal(plain.data.label, "去 笔记");
  assert.equal(web.classes.split(" ").includes("link"), true);
});

test("双链：带双链的节点有 link 类，data.links 里有 note", () => {
  const els = buildElements("根\n  去 [[笔记|别名]]\n");
  const n = els.filter((e) => e.group === "nodes")[1];
  assert.equal(n.classes.split(" ").includes("link"), true);
  assert.deepEqual(n.data.links, [{ kind: "note", text: "别名", url: "笔记" }]);
  assert.equal(n.data.label, "去 别名");
});

test("关联靠近排：同级按虚线重排，有关联的挨近；关着时按大纲顺序；有概要的那组不动", () => {
  const src = "根\n  甲\n    甲1\n  乙\n  丙\n  丁\n    丁1: (甲1)\n";
  const order = (els) => {
    const lab = new Map(els.filter((e) => e.group === "nodes").map((e) => [e.data.id, e]));
    const root = [...lab.values()].find((n) => n.data.label === "根");
    // 根的子节点按排出来的行号从上到下
    const kidsOfRoot = els.filter((e) => e.group === "edges" && !e.classes.includes("ref") && e.data.source === root.data.id).map((e) => lab.get(e.data.target));
    return kidsOfRoot.sort((a, b) => a.data.row - b.data.row).map((n) => n.data.label).join("");
  };
  assert.equal(order(buildElements(src, "logic")), "甲乙丙丁");
  const near = order(buildElements(src, "logic", { nearRefs: true }));
  assert.ok(near.indexOf("丁") - near.indexOf("甲") === 1 || near.indexOf("甲") - near.indexOf("丁") === 1, near);
  // 有概要的一组不动
  const withSum = "根\n  甲\n    甲1\n  乙\n  丙\n  } 三个\n  丁\n    丁1: (甲1)\n";
  assert.equal(order(buildElements(withSum, "logic", { nearRefs: true })), "甲乙丙丁");
});
