// 弧线怎么弯。插件（main.ts）和截图页（visual/driver.ts）共用。
//
// 弧线是思维导图里常见的那种 S 形：从父节点顺着排布方向平着出去，再平着进到子节点。
// 两头正好在一条线上时它就是一条直线——该直的地方直，才显得干净；
// 以前是每条线都朝同一侧鼓出一截，连本来笔直的主线也被掰弯了。

import type { Direction } from "./themes";

/**
 * 算一条线的两个控制点（cytoscape 的 unbundled-bezier 要的格式）：
 * weights 是沿「起点→终点」连线走到的比例，distances 是离开这条连线的距离。
 * 距离的正负是实测出来的：正值把竖直的线（上→下）推向屏幕左，把水平的线（左→右）推向屏幕下，
 * 也就是法线方向 n = (-dy, dx) / 长度。
 */
export function sCurve(
  a: { x: number; y: number },
  b: { x: number; y: number },
  axis: Direction,
  /** 两头节点的宽高：给了就按两个节点之间的空档定控制点，不给就按中心之间量 */
  size?: { a: { w: number; h: number }; b: { w: number; h: number } },
): { weights: [number, number]; distances: [number, number] } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1) return { weights: [0.33, 0.67], distances: [0, 0] };
  const len = Math.sqrt(len2);
  const straight = { weights: [0.33, 0.67] as [number, number], distances: [0, 0] as [number, number] };
  // 控制点放在两个节点边框之间的空档里，不放在按中心量的半路上：一头节点很宽、两个节点又挨得近时，
  // 按中心量的控制点会落进节点里面，绘图库算不出线头在哪，整条线就不画了（断线）。
  // 空档里也不放正中，放在靠父节点的那四分之一处：几条线在父节点旁边就转好弯，靠近子节点的那段是平的、各走各的，
  // 线上的字贴着子节点写在这段平线上，一眼看得出是哪条线的。
  const BEND = 0.25;
  /** 沿某个方向找空档：x 方向看左右、y 方向看上下；没有空档返回 null */
  const gapAlong = (dirAxis: Direction): { x: number; y: number } | null => {
    if (!size) return dirAxis === "LR" ? (Math.abs(dx) >= 1 ? { x: dx / 2, y: 0 } : null) : Math.abs(dy) >= 1 ? { x: 0, y: dy / 2 } : null;
    if (dirAxis === "LR") {
      const sg = Math.sign(dx) || 1;
      const gapA = a.x + (sg * size.a.w) / 2;
      const gapB = b.x - (sg * size.b.w) / 2;
      return (gapB - gapA) * sg > 4 ? { x: gapA + (gapB - gapA) * BEND - a.x, y: 0 } : null;
    }
    const sg = Math.sign(dy) || 1;
    const gapA = a.y + (sg * size.a.h) / 2;
    const gapB = b.y - (sg * size.b.h) / 2;
    return (gapB - gapA) * sg > 4 ? { x: 0, y: gapA + (gapB - gapA) * BEND - a.y } : null;
  };
  // 先按排布方向找空档；节点被拖到上下错开、左右挨着时（比如拖到父节点正上方），改成上下弯；两边都没空档就画直线
  const other: Direction = axis === "LR" ? "TB" : "LR";
  let bend: Direction = axis;
  let half = gapAlong(axis);
  if (!half && size) {
    half = gapAlong(other);
    bend = other;
  }
  if (!half) return straight;
  const p1 = half;
  // 第二个控制点和第一个在同一条竖线（横线）上：线平着出去、在空档里转弯、平着进来
  const p2 = bend === "LR" ? { x: half.x, y: dy } : { x: dx, y: half.y };
  const along = (p: { x: number; y: number }) => (p.x * dx + p.y * dy) / len2;
  const away = (p: { x: number; y: number }) => (p.x * -dy + p.y * dx) / len;
  return { weights: [along(p1), along(p2)], distances: [away(p1), away(p2)] };
}

/** 哪些线要弯：普通的连线。引用线有自己的绕法，大括号不是连线 */
const CURVED = (cy: any) => cy.edges().not(".ref").not(".summary").not(".brace");

/** 开着弧线时，把每条连线弯成 S 形；关掉时把写上去的控制点清掉 */
export function applyCurves(cy: any, axis: Direction, on: boolean, only?: any): void {
  const edges = only ?? CURVED(cy);
  if (!on) {
    edges.removeStyle("control-point-distances control-point-weights");
    return;
  }
  edges.forEach((e: any) => {
    if (e.hasClass("ref") || e.hasClass("summary") || e.hasClass("brace")) return;
    const sa = e.source();
    const tb = e.target();
    const c = sCurve(sa.position(), tb.position(), axis, {
      a: { w: sa.outerWidth(), h: sa.outerHeight() },
      b: { w: tb.outerWidth(), h: tb.outerHeight() },
    });
    e.style({
      "control-point-weights": c.weights.map((w) => w.toFixed(4)).join(" "),
      "control-point-distances": c.distances.map((d) => d.toFixed(2)).join(" "),
    });
  });
}
