// 鱼骨图的坐标和线。插件（main.ts）和截图页（visual/driver.ts）共用。
//
//                 骨 A                         骨 C
//     第一行 ──────╲              第一行 ───────╲
//       深一层 ─────╲               ...           ╲
//     第二行 ────────╲                             ╲
//  ━━━━━━━━━━━━━━━━━━━┻━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┻━━━━━━━ 头
//                     ╱ 第一行                     ╱
//                    ╱   ...                      ╱
//                 骨 B                         骨 D
//
// 主干横着走，头在最右；骨一上一下交替，从主干斜着长出去，骨的名字在斜线的末端；
// 骨底下的节点一行一个，横着接到斜骨上，越深往左缩进越多。
// graph.ts 的 layoutFish 只记每个节点的角色（data.fish），这里量完尺寸再算坐标。

/** 斜骨每往外走 1 像素，往左偏多少 */
const SLOPE = 0.55;
/** 最靠近主干的那一行离主干多远 */
const SPINE_GAP = 26;
/** 行和行之间 */
const ROW_GAP = 8;
/** 最外面一行和骨的名字之间 */
const LABEL_GAP = 14;
/** 行的右边离斜骨多远（没有线上的字时） */
const RIB = 14;
/** 每深一层往左缩进多少 */
const INDENT = 22;
/** 同一侧相邻两根骨之间至少空多少 */
const BONE_GAP = 24;
/** 相邻两根骨在主干上的落点至少隔多远 */
const MIN_STEP = 44;
/** 头离最后一根骨的落点多远 */
const HEAD_GAP = 36;
/** 两条鱼（好几个起点时）上下之间空多少 */
const FISH_GAP = 40;

export interface FishRole {
  role: "head" | "bone" | "row" | "loose";
  fish: number;
  bone?: number;
  side?: number;
  row?: number;
  depth?: number;
}

export interface FishCell {
  fish?: FishRole;
  w: number;
  h: number;
  /** 连进来那条线上的字有多宽（行要往左让出这么多） */
  labelW?: number;
}

/** 量完尺寸，算出每个节点的画布坐标，顺序跟 cells 一一对应 */
export function packFish(cells: FishCell[]): { x: number; y: number }[] {
  const out = cells.map(() => ({ x: 0, y: 0 }));
  const byFish = new Map<number, number[]>();
  cells.forEach((c, i) => {
    const f = c.fish?.fish ?? 0;
    if (!byFish.has(f)) byFish.set(f, []);
    byFish.get(f)!.push(i);
  });

  let top = 0; // 这条鱼的最上沿要放在哪
  for (const f of [...byFish.keys()].sort((a, b) => a - b)) {
    const idx = byFish.get(f)!;
    const head = idx.find((i) => cells[i].fish?.role === "head");
    const loose = idx.filter((i) => cells[i].fish?.role === "loose");
    const bones = new Map<number, { label: number; rows: number[] }>();
    for (const i of idx) {
      const r = cells[i].fish;
      if (!r || (r.role !== "bone" && r.role !== "row")) continue;
      const b = r.bone ?? 0;
      if (!bones.has(b)) bones.set(b, { label: -1, rows: [] });
      if (r.role === "bone") bones.get(b)!.label = i;
      else bones.get(b)!.rows.push(i);
    }

    // 先在「以落点为原点」的坐标里摆好每根骨，量出它往左占多宽
    const local = new Map<number, { x: number; y: number }>();
    const shape = new Map<number, { left: number; up: number; down: number }>();
    for (const [b, bone] of bones) {
      if (bone.label < 0) continue;
      const side = cells[bone.label].fish?.side ?? -1;
      // 一行一个，按大纲顺序从上往下摞。更深一层的线上写了字的话，这一行上面多空一点放字
      const rows = [...bone.rows].sort((p, q) => (cells[p].fish?.row ?? 0) - (cells[q].fish?.row ?? 0));
      const gapAbove = (i: number) => ((cells[i].fish?.depth ?? 1) > 1 && (cells[i].labelW ?? 0) > 0 ? 30 : ROW_GAP);
      const mid: number[] = [];
      let acc = 0;
      rows.forEach((i, k) => {
        if (k > 0) acc += gapAbove(i);
        mid.push(acc + cells[i].h / 2);
        acc += cells[i].h;
      });
      const total = acc;
      let left = 0;
      rows.forEach((i, k) => {
        const c = cells[i];
        // 上面的骨：最后一行贴着主干；下面的骨：第一行贴着主干
        const y = side < 0 ? -(SPINE_GAP + total) + mid[k] : SPINE_GAP + mid[k];
        const dist = Math.abs(y);
        const rib = (c.fish?.depth ?? 1) === 1 ? Math.max(RIB, (c.labelW ?? 0) + 18) : RIB;
        const right = -dist * SLOPE - rib - INDENT * ((c.fish?.depth ?? 1) - 1);
        local.set(i, { x: right - c.w / 2, y });
        left = Math.min(left, right - c.w);
      });
      const reach = SPINE_GAP + total + ROW_GAP;
      const lc = cells[bone.label];
      const dist = reach - ROW_GAP + LABEL_GAP + lc.h / 2;
      local.set(bone.label, { x: -dist * SLOPE, y: side * dist });
      left = Math.min(left, -dist * SLOPE - lc.w / 2);
      const far = dist + lc.h / 2;
      shape.set(b, { left, up: side < 0 ? far : 0, down: side > 0 ? far : 0 });
    }

    // 再从左往右定每根骨在主干上的落点：同一侧的骨不能叠，落点之间也要隔开
    const order = [...shape.keys()].sort((a, b) => a - b);
    const junction = new Map<number, number>();
    const lastOnSide = new Map<number, number>(); // 这一侧上一根骨的落点
    let prev = -Infinity;
    for (const b of order) {
      const sh = shape.get(b)!;
      const side = cells[bones.get(b)!.label].fish?.side ?? -1;
      let x = prev === -Infinity ? -sh.left : prev + MIN_STEP;
      const before = lastOnSide.get(side);
      if (before !== undefined) x = Math.max(x, before + BONE_GAP - sh.left);
      junction.set(b, x);
      lastOnSide.set(side, x);
      prev = x;
    }

    const up = Math.max(0, ...[...shape.values()].map((s) => s.up));
    const down = Math.max(0, ...[...shape.values()].map((s) => s.down));
    const headH = head !== undefined ? cells[head].h : 0;
    const spineY = top + Math.max(up, headH / 2);

    for (const [b, bone] of bones) {
      const jx = junction.get(b);
      if (jx === undefined) continue;
      for (const i of [bone.label, ...bone.rows]) {
        const p = local.get(i);
        if (p) out[i] = { x: jx + p.x, y: spineY + p.y };
      }
    }
    const lastJ = order.length ? junction.get(order[order.length - 1])! : 0;
    if (head !== undefined) out[head] = { x: lastJ + HEAD_GAP + cells[head].w / 2, y: spineY };

    // 漏掉的节点排在这条鱼下面一行
    let lx = 0;
    const looseY = spineY + Math.max(down, headH / 2) + FISH_GAP;
    for (const i of loose) {
      out[i] = { x: lx + cells[i].w / 2, y: looseY };
      lx += cells[i].w + MIN_STEP;
    }
    top = (loose.length ? looseY + 40 : spineY + Math.max(down, headH / 2)) + FISH_GAP;
  }
  return out;
}

/**
 * 把一串画布上的拐点换成 cytoscape segments 线要的格式：
 * weights 是沿「起点→终点」走到的比例，distances 是离开这条连线的距离（正值朝 (-dy, dx) 那一侧）。
 */
function segmentsThrough(a: { x: number; y: number }, b: { x: number; y: number }, pts: { x: number; y: number }[]) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1;
  const len = Math.sqrt(len2);
  return {
    weights: pts.map((p) => ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2),
    distances: pts.map((p) => ((p.x - a.x) * -dy + (p.y - a.y) * dx) / len),
  };
}

/**
 * 给鱼骨图的线定拐点。拖过节点也照样算：斜骨按「骨的名字 → 主干」那条斜线重新量。
 * - spine（头 → 骨）：沿主干走到落点，再顺着斜骨上去
 * - rib（骨 → 第一层）：顺着斜骨走到这一行的高度，再横着进到这一行
 * - twig（更深的层）：普通的竖横折线，由样式表管
 */
export function routeFish(cy: any): void {
  const spine = (bone: any) => {
    const head = bone.incomers("edge.spine").sources().first();
    const y = head.nonempty() ? head.position("y") : 0;
    const p = bone.position();
    return { x: p.x + Math.abs(p.y - y) * SLOPE, y };
  };
  cy.edges(".spine").forEach((e: any) => {
    const j = spine(e.target());
    const s = segmentsThrough(e.source().position(), e.target().position(), [j]);
    e.style({ "segment-weights": s.weights.map((w) => w.toFixed(4)).join(" "), "segment-distances": s.distances.map((d) => d.toFixed(2)).join(" ") });
  });
  cy.edges(".rib").forEach((e: any) => {
    const bone = e.source();
    const row = e.target();
    const j = spine(bone);
    const lp = bone.position();
    const y = row.position("y");
    const t = (y - lp.y) / (j.y - lp.y || 1);
    const on = { x: lp.x + (j.x - lp.x) * t, y };
    const s = segmentsThrough(lp, row.position(), [on]);
    e.style({ "segment-weights": s.weights.map((w) => w.toFixed(4)).join(" "), "segment-distances": s.distances.map((d) => d.toFixed(2)).join(" ") });
  });
}
