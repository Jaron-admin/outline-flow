// 拖节点时的吸附：往别的节点上对齐，像设计软件那样。
// 横向看左边、中线、右边，纵向看上边、中线、下边；离哪条最近、又在范围内，就贴过去，并画一条参考线。
// 不再对齐到 20 像素的小格子：格子太细，吸了跟没吸一样，还会把节点从别的节点的中线上拽开。
// 纯函数，测试里直接用。

export interface Box {
  x: number; // 中心
  y: number;
  w: number;
  h: number;
  /** 和正在拖的节点有线连着（父节点、子节点）：和它中线对中线最优先，线才会拉直 */
  linked?: boolean;
}

export interface Snap {
  x: number;
  y: number;
  /** 对上了哪条竖线（画参考线用），没对上是 null */
  vx: number | null;
  /** 对上了哪条横线 */
  hy: number | null;
}

/**
 * moving：正在拖的节点；others：别的节点；range：多近就吸过去（画布坐标，调用方按缩放换算好）。
 * 竖线：拖的节点的左、中、右，对别的节点的左、中、右；横线同理。取距离最小的一对。
 */
export function snapTo(moving: Box, others: Box[], range: number): Snap {
  const xs = (b: Box) => [b.x - b.w / 2, b.x, b.x + b.w / 2];
  const ys = (b: Box) => [b.y - b.h / 2, b.y, b.y + b.h / 2];
  let bestX = { d: Infinity, shift: 0, line: null as number | null };
  let bestY = { d: Infinity, shift: 0, line: null as number | null };
  const mx = xs(moving);
  const my = ys(moving);
  for (const o of others) {
    const ox = xs(o);
    const oy = ys(o);
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) {
        // 中线对中线优先：同样远时选它。和有线连着的节点中线对中线更优先——对上了这条线就是直的，
        // 只要在范围内就选它，不让别的节点的边抢走
        const bias = i === 1 && j === 1 ? (o.linked ? range : 0.5) : 0;
        const rawX = Math.abs(ox[j] - mx[i]);
        const rawY = Math.abs(oy[j] - my[i]);
        // 优先只是排名靠前，范围还是同一个：离得远的不会因为有线连着就被吸过去
        if (rawX <= range && rawX - bias < bestX.d) bestX = { d: rawX - bias, shift: ox[j] - mx[i], line: ox[j] };
        if (rawY <= range && rawY - bias < bestY.d) bestY = { d: rawY - bias, shift: oy[j] - my[i], line: oy[j] };
      }
  }
  return { x: moving.x + bestX.shift, y: moving.y + bestY.shift, vx: bestX.line, hy: bestY.line };
}
