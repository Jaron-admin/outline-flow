// 滚轮事件分类：图有焦点时，鼠标滚轮要缩放，触控板双指滑动要平移，捏合要缩放。
// 浏览器没有直接告诉我们「这是鼠标还是触控板」，只能从事件的数字上猜。纯函数，方便单独测。

export interface WheelLike {
  deltaX: number;
  deltaY: number;
  /** 0 像素、1 行、2 页 */
  deltaMode: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  /** 老接口：鼠标滚轮一格是 120 的整数倍；有的浏览器没有 */
  wheelDeltaY?: number;
}

/** pinch：触控板捏合；mouse：鼠标滚轮；trackpad：触控板双指滑动 */
export type WheelKind = "pinch" | "mouse" | "trackpad";

/** 上一个滚轮事件的类型和距现在多久（毫秒） */
export interface WheelPrev {
  kind: WheelKind;
  dt: number;
}

/** 触控板一次连续滑动里，两个事件之间不会隔这么久；隔得比这久就当是新的一次 */
const SAME_GESTURE_MS = 120;

/**
 * 猜这个滚轮事件是谁发的。依次看：
 * 1. 按着 Ctrl（没按 ⌘）：浏览器把触控板的捏合当成 Ctrl+滚轮发出来，数值又小又常带小数（一般不到 50）；
 *    鼠标按着 Ctrl 滚是整数、一格 100 上下。所以数值小或带小数是捏合，否则当鼠标。
 * 2. deltaMode 不是 0（按行、按页算）：只有鼠标滚轮会这样（Firefox）。
 * 3. 有横向分量（deltaX 不为 0）：鼠标滚轮没有横向，是触控板。
 * 4. deltaY 带小数：是触控板。
 * 5. wheelDeltaY 是 120 的整数倍、deltaY 是整数且不小于 50：鼠标滚轮一格（Chrome 在 Windows 上一格 deltaY 100、wheelDeltaY 120）。
 * 6. 其余都当触控板（它的值又小又碎，一次滑动会连发几十个）。
 * 7. 上面没有明确证据（第 5 条只靠整数倍）、而上一个事件 120 毫秒内才刚是触控板：沿用触控板，
 *    免得触控板偶尔凑出一个 120 的整数倍时，这一下被当成鼠标而缩放。
 * 这是猜的，不是百分之百：Mac 上的鼠标滚轮每格只有几个像素，会被当成触控板（平移）；
 * 这时按住 Shift 滚是横向平移，按住 ⌘ 或 Ctrl 滚一定是缩放，不受影响。
 */
export function wheelKind(e: WheelLike, prev?: WheelPrev | null): WheelKind {
  const integer = Number.isInteger(e.deltaY) && Number.isInteger(e.deltaX);
  if (e.ctrlKey && !e.metaKey) {
    return !integer || Math.abs(e.deltaY) < 50 ? "pinch" : "mouse";
  }
  if (e.deltaMode !== 0) return "mouse";
  if (e.deltaX !== 0 && !e.shiftKey) return "trackpad";
  if (!integer) return "trackpad";
  const notch = e.wheelDeltaY !== undefined && e.wheelDeltaY !== 0 && e.wheelDeltaY % 120 === 0 && Math.abs(e.deltaY) >= 50;
  if (notch) return prev && prev.kind === "trackpad" && prev.dt < SAME_GESTURE_MS ? "trackpad" : "mouse";
  return "trackpad";
}

/** 滚轮的位移统一成像素：按行的乘 16，按页的乘 400 */
export function wheelPixels(e: Pick<WheelLike, "deltaX" | "deltaY" | "deltaMode">): { x: number; y: number } {
  const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
  return { x: e.deltaX * k, y: e.deltaY * k };
}

export type WheelAction =
  | { type: "none" }
  /** 缩放倍数 = (1 + rate) 的 -delta 次方 */
  | { type: "zoom"; rate: number; delta: number }
  | { type: "pan"; dx: number; dy: number };

/**
 * 滚轮该干什么。
 * 图没有焦点：普通滚轮不拦截（让笔记自己滚）；按着 ⌘/Ctrl 滚是缩放（含触控板捏合）。
 * 图有焦点：竖着滚一律缩放，不再猜是鼠标还是触控板——Mac 上开了平滑滚动的鼠标和触控板分不清，
 * 猜错了就会变成平移。只有明显横着滑（触控板左右滑、Shift+滚轮）才是横向平移；要上下挪图就拖空白处。
 * rate 是缩放的灵敏度：缩放倍数 = (1 + rate) 的 -delta 次方；捏合的数值小，灵敏度要大一些。
 */
export function wheelAction(e: WheelLike, focused: boolean, prev?: WheelPrev | null): WheelAction {
  const mod = e.ctrlKey || e.metaKey;
  if (!focused && !mod) return { type: "none" };
  const kind = wheelKind(e, prev);
  const px = wheelPixels(e);
  if (mod || kind === "pinch") {
    return { type: "zoom", rate: kind === "pinch" ? 0.01 : 0.002, delta: px.y || px.x };
  }
  if (e.shiftKey) return { type: "pan", dx: px.x || px.y, dy: 0 };
  if (Math.abs(px.x) > Math.abs(px.y)) return { type: "pan", dx: px.x, dy: 0 };
  return { type: "zoom", rate: 0.002, delta: px.y };
}
