// 发散图的线。插件（main.ts）和截图页共用。
//
// 发散图的线朝四面八方，不能用别的结构那种「横平竖直」的折线，按圆来画：
// - 直线：两头直接连
// - 折线：从父节点沿半径走到两圈中间，顺着这一圈拐到子节点的方向，再沿半径进到子节点
// - 弧线：同样经过两圈中间，但是一条平滑的弯线；从中心出去的线没有「父节点的方向」，统一朝顺时针弯一点
// 拖过节点也照样按当前位置重新算。

import type { LineMode } from "./themes";

type P = { x: number; y: number };

/** 拐点（控制点）换成 cytoscape 要的比例和偏移，正值朝 (-dy, dx) 那一侧 */
function through(a: P, b: P, pts: P[]) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1;
  const len = Math.sqrt(len2);
  return {
    weights: pts.map((p) => (((p.x - a.x) * dx + (p.y - a.y) * dy) / len2).toFixed(4)).join(" "),
    distances: pts.map((p) => (((p.x - a.x) * -dy + (p.y - a.y) * dx) / len).toFixed(2)).join(" "),
  };
}

/** 圆心：有中心节点就是它；好几个起点时取第一圈节点的平均位置 */
function centerOf(cy: any): P {
  const nodes = cy.nodes().filter((n: any) => n.data("polar"));
  const mid = nodes.filter((n: any) => n.data("polar").depth === 0);
  if (mid.nonempty()) return { ...mid.first().position() };
  const first = nodes.filter((n: any) => n.data("polar").depth === 1);
  const list = first.nonempty() ? first : nodes;
  if (list.empty()) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  list.forEach((n: any) => {
    x += n.position("x");
    y += n.position("y");
  });
  return { x: x / list.length, y: y / list.length };
}

const polar = (o: P, p: P) => ({ r: Math.hypot(p.x - o.x, p.y - o.y), a: Math.atan2(p.y - o.y, p.x - o.x) });
const at = (o: P, r: number, a: number): P => ({ x: o.x + r * Math.cos(a), y: o.y + r * Math.sin(a) });

/** 从角 a 转到角 b 走近的那一边，返回带正负的转角 */
function turn(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** 父节点离圆心这么近，就当它是中心，没有自己的方向 */
const NEAR = 8;

export function routeRadial(cy: any, mode: LineMode): void {
  const edges = cy.edges(".ray");
  if (mode === "straight") {
    edges.removeStyle("segment-weights segment-distances control-point-weights control-point-distances");
    return;
  }
  const o = centerOf(cy);
  edges.forEach((e: any) => {
    const a: P = e.source().position();
    const b: P = e.target().position();
    const pa = polar(o, a);
    const pb = polar(o, b);
    const fromCenter = pa.r < NEAR;
    if (mode === "poly") {
      let pts: P[] = [];
      if (!fromCenter) {
        const r = (pa.r + pb.r) / 2;
        const d = turn(pa.a, pb.a);
        const steps = Math.max(1, Math.ceil(Math.abs(d) / 0.12));
        for (let i = 0; i <= steps; i++) pts.push(at(o, r, pa.a + (d * i) / steps));
      }
      // 没有拐点时给一个落在线中间的点，就是一条直线
      if (pts.length === 0) pts = [{ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }];
      const s = through(a, b, pts);
      e.style({ "segment-weights": s.weights, "segment-distances": s.distances });
      return;
    }
    let ctrl: P[];
    if (fromCenter) {
      // 从中心出去：沿线 1/3、2/3 处朝同一侧偏出线长的一成多，所有线都顺时针弯
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const k = 0.14 * len;
      const n = { x: -dy / len, y: dx / len };
      ctrl = [
        { x: a.x + dx / 3 - n.x * k, y: a.y + dy / 3 - n.y * k },
        { x: a.x + (dx * 2) / 3 - n.x * k * 0.6, y: a.y + (dy * 2) / 3 - n.y * k * 0.6 },
      ];
    } else {
      const r = (pa.r + pb.r) / 2;
      ctrl = [at(o, r, pa.a), at(o, r, pb.a)];
    }
    const s = through(a, b, ctrl);
    e.style({ "control-point-weights": s.weights, "control-point-distances": s.distances });
  });
}
