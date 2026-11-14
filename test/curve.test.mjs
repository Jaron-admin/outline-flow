import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const dir = mkdtempSync(join(tmpdir(), "outline-flow-curve-"));
buildSync({ entryPoints: ["src/curve.ts"], bundle: true, format: "esm", outfile: join(dir, "curve.mjs"), logLevel: "error" });
buildSync({ entryPoints: ["src/pack.ts"], bundle: true, format: "esm", outfile: join(dir, "pack.mjs"), logLevel: "error" });
const { sCurve } = await import(pathToFileURL(join(dir, "curve.mjs")).href);
const { packRadial, layoutPoints } = await import(pathToFileURL(join(dir, "pack.mjs")).href);

/** 把 weights / distances 还原成画布上的点，才好检查弯得对不对 */
function points(a, b, c) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  return c.weights.map((w, i) => ({
    x: a.x + dx * w + (-dy / len) * c.distances[i],
    y: a.y + dy * w + (dx / len) * c.distances[i],
  }));
}
const near = (p, q) => Math.abs(p.x - q.x) < 1e-6 && Math.abs(p.y - q.y) < 1e-6;

test("弧线：横排时平着出去、平着进来", () => {
  const a = { x: 0, y: 0 };
  const b = { x: 200, y: 80 };
  const [p1, p2] = points(a, b, sCurve(a, b, "LR"));
  assert.ok(near(p1, { x: 100, y: 0 }), "第一个控制点应该和起点同高");
  assert.ok(near(p2, { x: 100, y: 80 }), "第二个控制点应该和终点同高");
});

test("弧线：竖排时竖着出去、竖着进来；往左长的分支（思维导图左半边）也一样", () => {
  const a = { x: 0, y: 0 };
  const down = { x: 60, y: 120 };
  const [p1, p2] = points(a, down, sCurve(a, down, "TB"));
  assert.ok(near(p1, { x: 0, y: 60 }) && near(p2, { x: 60, y: 60 }));
  const left = { x: -200, y: -50 };
  const [q1, q2] = points(a, left, sCurve(a, left, "LR"));
  assert.ok(near(q1, { x: -100, y: 0 }) && near(q2, { x: -100, y: -50 }));
});

test("弧线：两头在一条线上时就是直线，不硬掰弯", () => {
  const c = sCurve({ x: 0, y: 0 }, { x: 200, y: 0 }, "LR");
  assert.ok(c.distances.every((d) => Math.abs(d) < 1e-9));
});

test("弧线：落在父节点正下方的支线是直线，而且画得出来", () => {
  // 以前这种线的两个控制点会缩到两个端点上，整条线消失
  const c = sCurve({ x: 0, y: 0 }, { x: 0, y: 100 }, "LR");
  assert.deepEqual(c.distances, [0, 0]);
  assert.ok(c.weights[0] > 0.1 && c.weights[1] < 0.9);
});

test("放射图：中心在原点，外圈比自己的父节点远；不挤的分支不会被别处挤的分支推远", () => {
  const cell = (depth, angle, span) => ({ polar: { depth, angle, span }, w: 80, h: 40 });
  // 分支甲（角度 0 附近）下面挤了很多节点，分支乙（角度 3）下面只有一个
  const cells = [cell(0, 0, 6.28), cell(1, 0, 2), cell(1, 3, 2)];
  for (let i = 0; i < 8; i++) cells.push(cell(2, -0.9 + i * 0.25, 0.25));
  cells.push(cell(2, 3, 2));
  const pts = packRadial(cells);
  assert.deepEqual(pts[0], { x: 0, y: 0 });
  const r = (p) => Math.hypot(p.x, p.y);
  assert.ok(r(pts[3]) > r(pts[1]) + 40, "外圈比父节点远");
  const crowded = r(pts[3]);
  const loose = r(pts[pts.length - 1]);
  assert.ok(loose < crowded - 20, `不挤的那个离中心近：${loose.toFixed(0)} vs ${crowded.toFixed(0)}`);
});

test("发散图：一圈上挤了很多节点时，半径会放大到谁也不压谁", () => {
  const n = 24;
  const span = (Math.PI * 2) / n;
  const cells = [{ polar: { depth: 0, angle: 0, span: 6.28 }, w: 80, h: 40 }];
  for (let i = 0; i < n; i++) cells.push({ polar: { depth: 1, angle: i * span, span }, w: 80, h: 40 });
  const pts = packRadial(cells);
  for (let i = 1; i <= n; i++) {
    const p = pts[i];
    const q = pts[i === n ? 1 : i + 1];
    const overlapX = Math.abs(p.x - q.x) < 80;
    const overlapY = Math.abs(p.y - q.y) < 40;
    assert.ok(!(overlapX && overlapY), `第 ${i} 个和下一个叠在一起了`);
  }
});

test("间距按需撑开：线上没字就紧凑，有字只撑开那一列（排）", () => {
  // 宽度给 100：比最窄的列宽（96）宽，量出来的才是净空本身
  const two = (extra) => [
    { col: 0, row: 0, w: 100, h: 40 },
    { col: 1, row: 0, w: 100, h: 40, ...extra },
  ];
  const colGap = (extra) => {
    const [a, b] = layoutPoints(two(extra), "trunk", "LR");
    return b.x - a.x - 100;
  };
  assert.equal(colGap({}), 40); // 只留箭头的地方
  assert.ok(colGap({ inLabel: "开放高危端口", inKind: "main" }) >= 6 * 12 + 8 + 20); // 放得下六个字
  // 正下方的支线：在排与排之间放字
  const rows = (extra) => {
    const [a, b] = layoutPoints([{ col: 0, row: 0, w: 100, h: 40 }, { col: 0, row: 1, w: 100, h: 40, ...extra }], "trunk", "LR");
    return b.y - a.y - 40;
  };
  assert.equal(rows({}), 18);
  assert.ok(rows({ inKind: "drop" }) >= 28);
  assert.ok(rows({ inKind: "drop", inLabel: "缺货" }) >= 23 + 20);
  // 概要前面要夹大括号
  assert.ok(colGap({ summary: true }) >= 46);
});

test("鱼骨图：节点谁也不压谁，头在最右边，骨一上一下", async () => {
  const { buildSync } = await import("esbuild");
  const g = join(dir, "graph.mjs");
  buildSync({ entryPoints: ["src/graph.ts"], bundle: true, format: "esm", outfile: g, logLevel: "error" });
  const { buildElements } = await import(pathToFileURL(g).href);
  const src = [
    "订单系统", "  下单", "    校验库存", "    生成订单", "      写入数据库", "    锁定优惠券",
    "  支付", "    微信支付", "    支付宝", "  发货", "    仓库拣货", "  售后", "  评价",
  ].join("\n");
  const nodes = buildElements(src, "fishbone").filter((e) => e.group === "nodes");
  const cells = nodes.map((n) => ({ fish: n.data.fish, w: 20 + n.data.label.length * 13, h: 34, inLabel: "" }));
  const pts = layoutPoints(cells, "fishbone", "LR");
  const box = (i) => ({ x1: pts[i].x - cells[i].w / 2, x2: pts[i].x + cells[i].w / 2, y1: pts[i].y - 17, y2: pts[i].y + 17 });
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const a = box(i);
      const b = box(j);
      const hit = a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;
      assert.ok(!hit, `「${nodes[i].data.label}」和「${nodes[j].data.label}」叠在一起了`);
    }
  }
  const at = Object.fromEntries(nodes.map((n, i) => [n.data.label, pts[i]]));
  const head = at["订单系统"];
  assert.ok(Object.values(at).every((p) => p.x <= head.x), "头不在最右边");
  assert.ok(at["下单"].y < head.y && at["支付"].y > head.y && at["发货"].y < head.y, "骨没有一上一下");
  // 同一根骨上的子项都在骨名和主干之间
  assert.ok(at["校验库存"].y > at["下单"].y && at["校验库存"].y < head.y);
  assert.ok(at["写入数据库"].y > at["生成订单"].y, "更深的一层没排在下面一行");
});
