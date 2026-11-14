import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const out = join(mkdtempSync(join(tmpdir(), "outline-flow-brace-")), "brace.mjs");
buildSync({ entryPoints: ["src/brace.ts"], bundle: true, format: "esm", outfile: out, logLevel: "error" });
const { braceShape, boxOf } = await import(pathToFileURL(out).href);

const box = { x1: 100, y1: 0, x2: 200, y2: 300 };

test("横排：概要的括号贴在被括范围朝外的一侧，往外鼓", () => {
  // 实测：竖直的线（上→下）距离取负值是往屏幕右鼓
  const right = braceShape(box, "LR", "right", "summary");
  assert.deepEqual([right.a, right.b], [{ x: 208, y: 0 }, { x: 208, y: 300 }]);
  assert.ok(right.distances.every((d) => d < 0));
  const left = braceShape(box, "LR", "left", "summary");
  assert.deepEqual([left.a, left.b], [{ x: 92, y: 0 }, { x: 92, y: 300 }]);
  assert.ok(left.distances.every((d) => d > 0));
});

test("括号图的括号夹在父节点和子节点中间，尖朝父节点", () => {
  const b = braceShape(box, "LR", "right", "brace"); // 子节点在父节点右边 → 括号在子节点左边
  assert.equal(b.a.x, 92);
  assert.ok(b.distances.every((d) => d > 0));
});

test("竖排：括号横在被括范围下面，往下鼓", () => {
  const b = braceShape(box, "TB", "right", "summary");
  assert.deepEqual([b.a, b.b], [{ x: 100, y: 308 }, { x: 200, y: 308 }]);
  assert.ok(b.distances.every((d) => d > 0));
});

test("弯钩和尖角是固定大小，不随括号长短变形", () => {
  const short = braceShape({ x1: 0, y1: 0, x2: 10, y2: 100 }, "LR", "right", "summary");
  const long = braceShape({ x1: 0, y1: 0, x2: 10, y2: 1000 }, "LR", "right", "summary");
  // 弯钩占的像素长度 = 权重 × 总长，两把括号应该一样
  assert.ok(Math.abs(short.weights[0] * 100 - long.weights[0] * 1000) < 1e-6);
  // 尖角的宽度也一样
  assert.ok(Math.abs((short.weights[3] - short.weights[1]) * 100 - (long.weights[3] - long.weights[1]) * 1000) < 1e-6);
  assert.deepEqual(short.distances, long.distances);
  // 上下对称
  assert.ok(Math.abs(long.weights[0] + long.weights[4] - 1) < 1e-9);
  assert.equal(long.weights[2], 0.5);
});

test("括号很短时整体缩小，控制点不交叉", () => {
  const tiny = braceShape({ x1: 0, y1: 0, x2: 10, y2: 20 }, "LR", "right", "summary");
  for (let i = 1; i < tiny.weights.length; i++) assert.ok(tiny.weights[i] > tiny.weights[i - 1]);
  assert.ok(Math.abs(tiny.distances[2]) < 18);
});

test("包围盒只按节点本身的位置和尺寸算", () => {
  const node = (x, y, w, h) => ({ position: () => ({ x, y }), outerWidth: () => w, outerHeight: () => h });
  assert.deepEqual(boxOf([node(0, 0, 40, 20), node(100, 50, 60, 20)]), { x1: -20, y1: -10, x2: 130, y2: 60 });
  assert.equal(boxOf([]), null);
});
