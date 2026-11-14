import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const out = join(mkdtempSync(join(tmpdir(), "outline-flow-pack-")), "pack.mjs");
buildSync({ entryPoints: ["src/pack.ts"], bundle: true, format: "esm", outfile: out, logLevel: "error" });
const { packPoints, GAP_CROSS, GAP_MAIN } = await import(pathToFileURL(out).href);

/** 两两检查有没有重叠（中心距大于半个宽之和 / 半个高之和） */
function overlaps(cells, pts) {
  for (let i = 0; i < cells.length; i++) {
    for (let j = i + 1; j < cells.length; j++) {
      const dx = Math.abs(pts[i].x - pts[j].x);
      const dy = Math.abs(pts[i].y - pts[j].y);
      if (dx < (cells[i].w + cells[j].w) / 2 - 0.01 && dy < (cells[i].h + cells[j].h) / 2 - 0.01) {
        return `${i} 和 ${j} 叠在一起（dx=${dx.toFixed(1)} dy=${dy.toFixed(1)}）`;
      }
    }
  }
  return "";
}

test("同一列的节点按最宽的那个定列宽，互相不重叠", () => {
  const cells = [
    { col: 0, row: 0, w: 120, h: 40 },
    { col: 1, row: 0, w: 120, h: 40 },
    { col: 1, row: 1, w: 90, h: 40 },
    { col: 2, row: 0, w: 200, h: 40 },
  ];
  const pts = packPoints(cells, "LR");
  assert.equal(overlaps(cells, pts), "");
  // 同一列的 x 必须一致，否则列就歪了
  assert.equal(pts[1].x, pts[2].x);
  // 列距 = 那一列最宽 + 净空：第 1 列宽 120
  assert.equal(pts[1].x - pts[0].x, 120 + GAP_MAIN);
  // 同一排的 y 一致
  assert.equal(pts[0].y, pts[1].y);
});

test("行距随节点高度变：高节点把整排撑开", () => {
  const flat = packPoints(
    [
      { col: 0, row: 0, w: 100, h: 40 },
      { col: 1, row: 0, w: 100, h: 40 },
      { col: 1, row: 1, w: 100, h: 40 },
    ],
    "LR",
  );
  const tall = packPoints(
    [
      { col: 0, row: 0, w: 100, h: 40 },
      { col: 1, row: 0, w: 100, h: 120 },
      { col: 1, row: 1, w: 100, h: 40 },
    ],
    "LR",
  );
  assert.equal(flat[2].y - flat[1].y, 40 + GAP_CROSS);
  // 中心到中心的距离 = 两排各半个 + 净空：高节点把这一排撑开，矮的不会把它压回去
  assert.equal(tall[2].y - tall[1].y, (120 + 40) / 2 + GAP_CROSS, "矮的那个不该把行距压回去");
});

test("拿不到尺寸时按兜底值算，不会把节点叠成一坨", () => {
  const cells = [
    { col: 0, row: 0, w: 0, h: 0 },
    { col: 0, row: 1, w: 0, h: 0 },
  ];
  const pts = packPoints(cells, "LR");
  assert.ok(pts[1].y - pts[0].y >= 36, "两个 0 高的节点至少要隔开兜底高度");
});

test("竖排（TB）把深度放到 y 上，兄弟放到 x 上", () => {
  const cells = [
    { col: 0, row: 0, w: 100, h: 40 },
    { col: 1, row: 0, w: 100, h: 40 },
    { col: 1, row: 1, w: 100, h: 40 },
  ];
  const pts = packPoints(cells, "TB");
  assert.ok(pts[1].y > pts[0].y, "下一层该在更下面");
  assert.equal(pts[1].x, pts[0].x);
  assert.ok(pts[2].x > pts[1].x, "同一层的兄弟该往右挪");
  assert.equal(overlaps(cells, pts), "");
});

test("小数坐标落在两条道之间，不额外撑开间距", () => {
  // 鱼骨图的斜刺、树布局里父节点居中都会算出小数 row。
  // 每来一个小数就多插一条道的话，整摞节点会被越撑越开。
  const withHalf = packPoints(
    [
      { col: 0, row: 0, w: 100, h: 40 },
      { col: 0, row: 1, w: 100, h: 40 },
      { col: 1, row: 0.5, w: 100, h: 40 },
    ],
    "LR",
  );
  const plain = packPoints(
    [
      { col: 0, row: 0, w: 100, h: 40 },
      { col: 0, row: 1, w: 100, h: 40 },
    ],
    "LR",
  );
  assert.deepEqual(withHalf[0], plain[0]);
  assert.deepEqual(withHalf[1], plain[1]);
  // 0.5 正好在两道中间
  assert.equal(withHalf[2].y, (plain[0].y + plain[1].y) / 2);
});

test("负的 col 往反方向长（思维导图左半边）", () => {
  const pts = packPoints(
    [
      { col: 0, row: 0, w: 100, h: 40 },
      { col: 1, row: 0, w: 100, h: 40 },
      { col: -1, row: 0, w: 100, h: 40 },
    ],
    "LR",
  );
  assert.ok(pts[2].x < pts[0].x && pts[0].x < pts[1].x);
  assert.equal(pts[0].x - pts[2].x, pts[1].x - pts[0].x);
});

test("一个节点就落在自己那条道的中心，空图不报错", () => {
  const [p] = packPoints([{ col: 0, row: 0, w: 100, h: 40 }], "LR");
  // 第一条道从 0 开始，不在前面白留半个净空
  assert.deepEqual(p, { x: 50, y: 20 });
  assert.deepEqual(packPoints([], "LR"), []);
});

test("括号图加大净空：同一层的兄弟之间留出断口", () => {
  const cells = [
    { col: 1, row: 0, w: 100, h: 40 },
    { col: 1, row: 1, w: 100, h: 40 },
  ];
  const normal = packPoints(cells, "LR");
  const wide = packPoints(cells, "LR", { cross: 34 });
  assert.equal(normal[1].y - normal[0].y, 40 + GAP_CROSS);
  assert.equal(wide[1].y - wide[0].y, 40 + 34);
});
