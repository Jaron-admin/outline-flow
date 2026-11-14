import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// 滚轮分类是纯函数（src/wheel.ts）：图有焦点时，鼠标滚轮缩放、触控板双指平移
const out = join(mkdtempSync(join(tmpdir(), "outline-flow-wheel-")), "wheel.mjs");
buildSync({ entryPoints: ["src/wheel.ts"], bundle: true, format: "esm", outfile: out, logLevel: "error" });
const { wheelKind, wheelAction, wheelPixels } = await import(pathToFileURL(out).href);

const ev = (o) => ({ deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, metaKey: false, shiftKey: false, ...o });

test("分类：Chrome 在 Windows 上鼠标滚轮一格 deltaY 100、wheelDeltaY 120 → 鼠标", () => {
  assert.equal(wheelKind(ev({ deltaY: 100, wheelDeltaY: -120 })), "mouse");
  assert.equal(wheelKind(ev({ deltaY: -100, wheelDeltaY: 120 })), "mouse");
  assert.equal(wheelKind(ev({ deltaY: 200, wheelDeltaY: -240 })), "mouse");
});

test("分类：按行、按页的滚轮（Firefox 的鼠标）→ 鼠标", () => {
  assert.equal(wheelKind(ev({ deltaY: 3, deltaMode: 1 })), "mouse");
  assert.equal(wheelKind(ev({ deltaY: 1, deltaMode: 2 })), "mouse");
});

test("分类：有横向分量、带小数、数值又小又碎 → 触控板", () => {
  assert.equal(wheelKind(ev({ deltaX: 4, deltaY: 12, wheelDeltaY: -36 })), "trackpad");
  assert.equal(wheelKind(ev({ deltaY: 7.5 })), "trackpad");
  assert.equal(wheelKind(ev({ deltaY: 3, wheelDeltaY: -9 })), "trackpad");
  assert.equal(wheelKind(ev({ deltaY: 1 })), "trackpad", "没有 wheelDeltaY 的也按数值判");
  assert.equal(wheelKind(ev({ deltaY: 40, wheelDeltaY: -120 })), "trackpad", "凑出 120 的整数倍但数值小于 50 → 触控板");
});

test("分类：Ctrl+滚轮——小的、带小数的是捏合；整格 100 的是鼠标；按着 ⌘ 的不当捏合", () => {
  assert.equal(wheelKind(ev({ ctrlKey: true, deltaY: -3 })), "pinch");
  assert.equal(wheelKind(ev({ ctrlKey: true, deltaY: 4.25 })), "pinch");
  assert.equal(wheelKind(ev({ ctrlKey: true, deltaY: 100, wheelDeltaY: -120 })), "mouse");
  assert.equal(wheelKind(ev({ metaKey: true, deltaY: 100, wheelDeltaY: -120 })), "mouse");
});

test("分类：触控板一次连续滑动里偶尔凑出整格的值，沿用触控板", () => {
  const notch = ev({ deltaY: 100, wheelDeltaY: -120 });
  assert.equal(wheelKind(notch, { kind: "trackpad", dt: 16 }), "trackpad");
  assert.equal(wheelKind(notch, { kind: "trackpad", dt: 500 }), "mouse", "隔了很久就是新的一次");
  assert.equal(wheelKind(notch, { kind: "mouse", dt: 16 }), "mouse");
});

test("像素：按行乘 16，按页乘 400", () => {
  assert.deepEqual(wheelPixels(ev({ deltaX: 1, deltaY: 3, deltaMode: 1 })), { x: 16, y: 48 });
  assert.deepEqual(wheelPixels(ev({ deltaY: 2, deltaMode: 2 })), { x: 0, y: 800 });
  assert.deepEqual(wheelPixels(ev({ deltaX: 5, deltaY: 7 })), { x: 5, y: 7 });
});

test("动作：图没有焦点，普通滚轮不拦截（笔记自己滚）；⌘/Ctrl+滚轮缩放", () => {
  assert.deepEqual(wheelAction(ev({ deltaY: 100, wheelDeltaY: -120 }), false), { type: "none" });
  assert.deepEqual(wheelAction(ev({ deltaY: 7.5 }), false), { type: "none" });
  assert.deepEqual(wheelAction(ev({ deltaY: 100, wheelDeltaY: -120, metaKey: true }), false), { type: "zoom", rate: 0.002, delta: 100 });
  assert.deepEqual(wheelAction(ev({ deltaY: 100, wheelDeltaY: -120, ctrlKey: true }), false), { type: "zoom", rate: 0.002, delta: 100 });
  const pinch = wheelAction(ev({ deltaY: -4.5, ctrlKey: true }), false);
  assert.equal(pinch.type, "zoom");
  assert.equal(pinch.rate, 0.01, "捏合的数值小，灵敏度大一些");
});

test("动作：图有焦点，竖着滚一律缩放（鼠标、平滑滚动的鼠标、触控板都一样），明显横滑才平移", () => {
  assert.deepEqual(wheelAction(ev({ deltaY: 100, wheelDeltaY: -120 }), true), { type: "zoom", rate: 0.002, delta: 100 });
  assert.deepEqual(wheelAction(ev({ deltaY: 9 }), true), { type: "zoom", rate: 0.002, delta: 9 }, "Mac 平滑滚动的鼠标");
  assert.deepEqual(wheelAction(ev({ deltaX: 6, deltaY: 14.5 }), true), { type: "zoom", rate: 0.002, delta: 14.5 }, "竖向为主");
  assert.deepEqual(wheelAction(ev({ deltaX: 20, deltaY: 3 }), true), { type: "pan", dx: 20, dy: 0 }, "横滑");
  assert.equal(wheelAction(ev({ deltaY: -3.2, ctrlKey: true }), true).type, "zoom");
});

test("动作：图有焦点，Shift+滚轮横向平移（滚轮的竖向值当横向用）", () => {
  assert.deepEqual(wheelAction(ev({ shiftKey: true, deltaY: 100, wheelDeltaY: -120 }), true), { type: "pan", dx: 100, dy: 0 });
  assert.deepEqual(wheelAction(ev({ shiftKey: true, deltaX: 100, deltaY: 0 }), true), { type: "pan", dx: 100, dy: 0 });
});

test("动作：按行滚的鼠标缩放量按像素算", () => {
  assert.deepEqual(wheelAction(ev({ deltaY: 3, deltaMode: 1 }), true), { type: "zoom", rate: 0.002, delta: 48 });
});
