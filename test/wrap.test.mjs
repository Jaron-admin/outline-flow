import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// 中文断行（src/wrap.ts）：标点禁则、英文词不拆、各行均匀
const out = join(mkdtempSync(join(tmpdir(), "outline-flow-wrap-")), "wrap.mjs");
buildSync({ entryPoints: ["src/wrap.ts"], bundle: true, format: "esm", outfile: out, logLevel: "error" });
const { wrapText, estimate } = await import(pathToFileURL(out).href);

const m = estimate(14); // 中文一个字 14 宽
const lines = (t, max) => wrapText(t, max, m).split("\n");

test("逗号、句号不放行首", () => {
  const t = "《金匮要略》「见肝之病，知肝传脾，当先实脾」";
  for (const max of [70, 84, 98, 112, 126, 140, 154]) {
    for (const l of lines(t, max)) assert.ok(!/^[，。、；：！？」》）]/.test(l), `${max}: ${JSON.stringify(lines(t, max))}`);
  }
});

test("开头的引号、书名号不留在行尾", () => {
  const t = "道理是这样的「见肝之病」和《难经》都讲过";
  for (const max of [56, 70, 84, 98, 112]) {
    for (const l of lines(t, max)) assert.ok(!/[「《（“]$/.test(l), `${max}: ${JSON.stringify(lines(t, max))}`);
  }
});

test("最后一行不会只剩一个字：各行长短均匀", () => {
  const t = "木烧成火，火烧成灰土，土里出金，金上凝水，水养树木。";
  const ls = lines(t, 150);
  assert.ok(ls.length >= 2);
  const lens = ls.map((l) => [...l].length);
  assert.ok(Math.min(...lens) >= Math.max(...lens) - 3, JSON.stringify(ls));
});

test("英文词、网址、数字不拆开", () => {
  const ls = lines("打开 127.0.0.1:1880 看 debug 输出", 160);
  assert.ok(ls.some((l) => l.includes("127.0.0.1:1880")), JSON.stringify(ls));
  assert.ok(ls.some((l) => /\bdebug\b/.test(l)), JSON.stringify(ls));
});

test("一个词比一行还宽时才在词里切", () => {
  const ls = lines("https://nodered.org/docs/user-guide/nodes", 100);
  assert.ok(ls.length > 1);
  for (const l of ls) assert.ok(m(l) <= 100 + 0.01, JSON.stringify(ls));
});

test("放得下就不断；原文里的换行保留", () => {
  assert.equal(wrapText("木克土", 160, m), "木克土");
  assert.equal(wrapText("第一行\n第二行", 160, m), "第一行\n第二行");
});

// 吸附（src/snap.ts）
const out2 = join(mkdtempSync(join(tmpdir(), "outline-flow-snap-")), "snap.mjs");
buildSync({ entryPoints: ["src/snap.ts"], bundle: true, format: "esm", outfile: out2, logLevel: "error" });
const { snapTo } = await import(pathToFileURL(out2).href);

test("吸附：中线差几像素就贴上，并给出参考线的位置", () => {
  const r = snapTo({ x: 108, y: 47, w: 60, h: 30 }, [{ x: 100, y: 200, w: 60, h: 30 }, { x: 400, y: 40, w: 60, h: 30 }], 14);
  assert.equal(r.x, 100);
  assert.equal(r.vx, 100);
  assert.equal(r.y, 40);
  assert.equal(r.hy, 40);
});

test("吸附：左边对左边", () => {
  const r = snapTo({ x: 205, y: 0, w: 100, h: 30 }, [{ x: 180, y: 300, w: 50, h: 30 }], 14);
  // 拖的左边 155，别人的左边 155 → 不用动；改成差 6
  const r2 = snapTo({ x: 211, y: 0, w: 100, h: 30 }, [{ x: 180, y: 300, w: 50, h: 30 }], 14);
  assert.equal(r.vx, 155);
  assert.equal(r2.x, 205);
});

test("吸附：离得远就不动，没有参考线", () => {
  const r = snapTo({ x: 0, y: 0, w: 60, h: 30 }, [{ x: 300, y: 300, w: 60, h: 30 }], 14);
  assert.deepEqual(r, { x: 0, y: 0, vx: null, hy: null });
});

test("吸附：和有线连着的节点中线对中线优先，哪怕别的节点的边更近", () => {
  // 拖的节点高 30，中线 y=108；父节点中线 y=100（差 8）；另一个节点的上边 y=106（差 2）
  const r = snapTo({ x: 0, y: 108, w: 60, h: 30 }, [{ x: 300, y: 100, w: 60, h: 30, linked: true }, { x: 600, y: 121, w: 60, h: 30 }], 14);
  assert.equal(r.y, 100);
  // 有线连着的离得太远（超出范围）也不吸
  const far = snapTo({ x: 0, y: 130, w: 60, h: 30 }, [{ x: 300, y: 100, w: 60, h: 30, linked: true }], 14);
  assert.equal(far.y, 130);
});

test("吸附：横竖都吸到同一个节点上会叠在一起时，只吸一个方向", () => {
  const r = snapTo({ x: 105, y: 106, w: 60, h: 30 }, [{ x: 100, y: 100, w: 60, h: 30 }], 14);
  const overlap = Math.abs(r.x - 100) < 60 - 1 && Math.abs(r.y - 100) < 30 - 1;
  assert.ok(!(r.x === 100 && r.y === 100), JSON.stringify(r));
  // 原地本来就叠着时，不吸也不会更糟；吸了就不能叠
  if (r.vx !== null || r.hy !== null) assert.ok(!overlap, JSON.stringify(r));
});
