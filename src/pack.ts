// 把排版算出来的格子坐标（col / row）换成画布坐标。
// 格距不写死：同一列 / 同一排的节点按其中最大的那个定尺寸，短节点不会白占地方，
// 长节点（换行换到三四行）也不会和隔壁叠在一起。
// 纯函数，不碰 cytoscape，方便直接测。

import type { Direction, Structure } from "./themes";
import { FishRole, packFish } from "./fish";

/** 层级之间的净空：够放下箭头（线上有字时另外按字的长度加宽，见 layoutPoints） */
export const GAP_MAIN = 40;
/** 同一层相邻节点的净空 */
export const GAP_CROSS = 18;

/** 线上的字大概占多大：中文按 12 像素一个字、西文按 7，再加上衬底的留白 */
export function labelSize(text: string): { w: number; h: number } {
  if (!text) return { w: 0, h: 0 };
  let w = 0;
  for (const ch of text) w += ch.charCodeAt(0) > 0x2e80 ? 12 : 7;
  return { w: w + 8, h: 23 };
}

/** 拿不到实际尺寸时的兜底，免得算出 0 宽的列把节点叠成一坨 */
const MIN_MAIN_LR = 96;
const MIN_MAIN_TB = 40;
const MIN_CROSS_LR = 36;
const MIN_CROSS_TB = 96;

export interface Cell {
  /** 这一列 / 这一排前面至少要空多少（线上有字、要夹大括号时比默认宽） */
  before?: { main?: number; cross?: number };
  /** 沿深度方向的格子坐标；思维导图左半边是负数 */
  col: number;
  /** 垂直深度方向的格子坐标；可以是小数（鱼骨图的斜刺、树布局里父节点居中） */
  row: number;
  w: number;
  h: number;
}

/** 沿深度轴量：横向排看宽度，纵向排看高度 */
function mainSize(c: Cell, dir: Direction): number {
  return dir === "LR" ? Math.max(c.w, MIN_MAIN_LR) : Math.max(c.h, MIN_MAIN_TB);
}

/** 垂直深度轴量 */
function crossSize(c: Cell, dir: Direction): number {
  return dir === "LR" ? Math.max(c.h, MIN_CROSS_LR) : Math.max(c.w, MIN_CROSS_TB);
}

/**
 * 一条轴上的坐标换算。同一条线上（同列或同排）的节点统一按最大的那个算步距，
 * 求出来的值是那条线的**中心**，所以长短不一的节点天然居中对齐。
 *
 * 只有整数坐标算「一条道」。树布局里父节点落在子节点中间，会算出 1.5 这种小数；
 * 鱼骨图的斜刺也故意错开半排。这些是插值位置，不能各占一条道——
 * 否则每插一个点，整摞节点就被撑开一次。
 */
function axisCenter(items: { at: number; size: number; before?: number; after?: number }[], gap: number): (v: number) => number {
  // before：这条道和前一条道之间至少空多少；after：和后一条道之间至少空多少。
  // 思维导图左半边的列是负数、从右往左长，连进来的线在这一列的「后面」（靠父节点那边），所以用 after
  const lane = new Map<number, { size: number; before: number; after: number }>();
  const add = (k: number, it: { size: number; before?: number; after?: number }) => {
    const cur = lane.get(k) ?? { size: 0, before: gap, after: gap };
    lane.set(k, { size: Math.max(cur.size, it.size), before: Math.max(cur.before, it.before ?? gap), after: Math.max(cur.after, it.after ?? gap) });
  };
  for (const it of items) {
    const k = Math.round(it.at);
    if (Math.abs(it.at - k) > 1e-6) continue; // 小数位置不占道
    add(k, it);
  }
  if (lane.size === 0) for (const it of items) add(it.at, it);
  const keys = [...lane.keys()].sort((a, b) => a - b);
  if (keys.length === 0) return () => 0;
  // 每条道的中心：上一条道的中心 + 两条道各自的一半 + 这条道前面要空的那段
  const center = new Map<number, number>();
  let prev: number | null = null;
  for (const k of keys) {
    const l = lane.get(k)!;
    if (prev === null) center.set(k, l.size / 2);
    else center.set(k, center.get(prev)! + lane.get(prev)!.size / 2 + Math.max(l.before, lane.get(prev)!.after) + l.size / 2);
    prev = k;
  }
  const outer = (k: number) => lane.get(k)!.size + gap;

  return (v: number): number => {
    const exact = center.get(v);
    if (exact !== undefined) return exact;
    // 小数坐标落在两条道之间：按比例插值，斜向关系才不会断
    const first = keys[0];
    if (v < first) return center.get(first)! - (first - v) * outer(first);
    const last = keys[keys.length - 1];
    if (v > last) return center.get(last)! + (v - last) * outer(last);
    let i = 0;
    while (i + 1 < keys.length && keys[i + 1] < v) i++;
    const a = keys[i];
    const b = keys[i + 1];
    const t = (v - a) / (b - a);
    return center.get(a)! + t * (center.get(b)! - center.get(a)!);
  };
}

/** 格子坐标 -> 画布坐标，顺序跟 cells 一一对应 */
export function packPoints(
  cells: Cell[],
  dir: Direction,
  gap: { main?: number; cross?: number } = {},
): { x: number; y: number }[] {
  const main = axisCenter(
    cells.map((c) => (c.col < 0 ? { at: c.col, size: mainSize(c, dir), after: c.before?.main } : { at: c.col, size: mainSize(c, dir), before: c.before?.main })),
    gap.main ?? GAP_MAIN,
  );
  const cross = axisCenter(
    cells.map((c) => ({ at: c.row, size: crossSize(c, dir), before: c.before?.cross })),
    gap.cross ?? GAP_CROSS,
  );
  return cells.map((c) => {
    const m = main(c.col);
    const k = cross(c.row);
    return dir === "LR" ? { x: m, y: k } : { x: k, y: m };
  });
}

/** 发散图里一个节点的极坐标（见 graph.ts 的 layoutRadial） */
export interface Polar {
  depth: number;
  angle: number;
  span: number;
}

/** 发散图相邻两圈之间的净空：够放下箭头和线上的字 */
export const GAP_RING = 46;
/** 同一圈上相邻两个节点之间的净空 */
export const GAP_ARC = 14;

/**
 * 发散图：极坐标 -> 画布坐标。每一圈的半径取两个要求里大的那个：
 * 1. 比里面一圈远出「两圈节点各自朝外的那一半 + 净空」，圈和圈不叠；
 * 2. 大到这一圈上每个节点在自己那段角度里放得下，同一圈的邻居不叠。
 */
export function packRadial(cells: { polar: Polar; w: number; h: number }[]): { x: number; y: number }[] {
  // 每个节点自己定半径，不再整圈取同一个：以前一圈里只要有一处挤（某个分支下面节点多、每个分到的角度小），
  // 整圈都被推到很远，别的分支的线也跟着拉得老长。现在只在挤的地方往外推，别处紧贴父节点。
  const info = cells.map((c) => {
    const { angle } = c.polar;
    const cos = Math.abs(Math.cos(angle));
    const sin = Math.abs(Math.sin(angle));
    return {
      reach: (c.w * cos + c.h * sin) / 2, // 沿半径方向占多长（一半）
      along: c.w * sin + c.h * cos, // 沿圆周方向占多长
    };
  });
  const order = cells.map((_, i) => i).sort((a, b) => cells[a].polar.depth - cells[b].polar.depth);
  const r = new Array<number>(cells.length).fill(0);
  // 父节点：上一层里角度范围包住它的那个
  const inside = (p: Polar, a: number) => {
    const d = (((a - (p.angle - p.span / 2)) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    return d <= p.span + 1e-6;
  };
  for (const i of order) {
    const c = cells[i];
    const { depth, span } = c.polar;
    if (depth === 0) continue;
    let base = 0;
    let baseReach = 0;
    for (const j of order) {
      const q = cells[j].polar;
      if (q.depth !== depth - 1) continue;
      if (depth - 1 === 0 || inside(q, c.polar.angle)) {
        base = r[j];
        baseReach = info[j].reach;
        if (depth - 1 !== 0) break;
        baseReach = Math.max(baseReach, info[j].reach);
      }
    }
    const need = (info[i].along + GAP_ARC) / Math.min(span, Math.PI); // 在自己那一份角度里放得下
    r[i] = Math.max(base + baseReach + info[i].reach + GAP_RING, need);
  }
  return cells.map((c, i) => ({ x: r[i] * Math.cos(c.polar.angle), y: r[i] * Math.sin(c.polar.angle) }));
}

/** 一个节点排版要用到的全部信息 */
export interface LayoutCell extends Cell {
  polar?: Polar;
  fish?: FishRole;
  /** 连进来的那条线上写的字、那条线是哪种（drop 是从父节点正下方垂直出来的） */
  inLabel?: string;
  inKind?: string;
  /** 概要节点：它前面要夹一把大括号 */
  summary?: boolean;
}

/**
 * 按结构把格子坐标换成画布坐标。插件和截图页共用，免得两边各写一遍走样。
 *
 * 间距尽量紧：默认只留够放箭头的空，哪一列（排）的线上写了字，就只把那一列（排）按字的长度撑开；
 * 概要节点前面要夹大括号，也只撑开它那一列。括号图父子之间夹括号、兄弟之间留断口，单独给宽一点。
 */
export function layoutPoints(cells: LayoutCell[], structure: Structure, axis: Direction): { x: number; y: number }[] {
  if (structure === "radial") {
    return packRadial(cells.map((c) => ({ polar: c.polar ?? { depth: 0, angle: 0, span: Math.PI * 2 }, w: c.w, h: c.h })));
  }
  if (structure === "fishbone") {
    return packFish(cells.map((c) => ({ fish: c.fish, w: c.w, h: c.h, labelW: labelSize(c.inLabel ?? "").w })));
  }
  const sized = cells.map((c) => {
    const before: { main?: number; cross?: number } = {};
    const label = labelSize(c.inLabel ?? "");
    if (c.inKind === "drop") {
      // 垂直于主线出去的线：沿这条线方向量字，再加箭头和两头的留白
      const along = axis === "LR" ? label.h : label.w;
      before.cross = Math.max(28, along ? along + 22 : 0);
    } else if (label.w) {
      const along = axis === "LR" ? label.w : label.h;
      before.main = along + 28;
    }
    if (c.summary) before.main = Math.max(before.main ?? 0, 46);
    return { ...c, before };
  });
  const gap = structure === "brace" ? { main: 80, cross: 34 } : {};
  return packPoints(sized, axis, gap);
}
