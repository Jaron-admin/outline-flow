// 大括号怎么画。插件（main.ts）和截图页（visual/driver.ts）共用这一份，免得两边各抄一遍走样。
//
// 一把大括号是一条从锚点 a 到锚点 b 的 round-segments 边，中间五个控制点连成 } 的轮廓。
// 弯钩和尖角是**固定的像素大小**，只有两段直的脊线跟着长度伸缩——
// 以前按长度的百分比算，长括号的尖角又大又斜，短括号的几乎看不见。

import type { Direction } from "./themes";

export interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface BraceSpec {
  /** 这条边的 id；两个锚点是 id + "::a" / "::b" */
  id: string;
  /** 括号要罩住的全部节点 */
  all: string[];
  /** 被括的节点在父节点的哪一侧（思维导图左半边是 left） */
  side: "left" | "right";
  /** summary：手写的 `} 概要`，画在被括范围的外侧；brace：括号图自动配的，夹在父节点和子节点中间 */
  kind: "summary" | "brace";
}

/** 括号离节点留多少空 */
const GAP = 8;
/** 两头的弯钩沿脊线方向占多长 */
const HOOK = 10;
/** 脊线离两头锚点连线多远 */
const ARM = 9;
/** 尖角比脊线再探出去多少 */
const TIP = 9;
/** 尖角沿脊线方向的半宽 */
const TIP_HALF = 9;

export interface BraceShape {
  a: { x: number; y: number };
  b: { x: number; y: number };
  weights: number[];
  distances: number[];
}

/**
 * 算一把大括号的锚点和轮廓。
 * 横排（LR）：括号是竖的，贴在包围盒的左边或右边；竖排（TB）：括号是横的，贴在包围盒下边。
 * 鼓出方向的正负是实测出来的：segment-distances 取正值时，
 * 竖直的线（上→下）被推到屏幕左，水平的线（左→右）被推到屏幕下。
 */
export function braceShape(box: Box, axis: Direction, side: "left" | "right", kind: "summary" | "brace"): BraceShape {
  let a: { x: number; y: number };
  let b: { x: number; y: number };
  let sign: number;
  if (axis === "LR") {
    // 概要在被括范围朝外的一侧；括号图的括号在靠父节点的一侧。两种都往「离开节点」的方向鼓
    const onRight = kind === "summary" ? side === "right" : side === "left";
    const x = onRight ? box.x2 + GAP : box.x1 - GAP;
    a = { x, y: box.y1 };
    b = { x, y: box.y2 };
    sign = onRight ? -1 : 1;
  } else {
    const y = box.y2 + GAP;
    a = { x: box.x1, y };
    b = { x: box.x2, y };
    sign = 1;
  }
  const len = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
  // 太短放不下完整的弯钩和尖角时，整体按比例缩小
  const f = Math.min(1, len / (2 * (HOOK + TIP_HALF) + 8));
  const hook = (HOOK * f) / len;
  const tip = (TIP_HALF * f) / len;
  return {
    a,
    b,
    weights: [hook, 0.5 - tip, 0.5, 0.5 + tip, 1 - hook],
    distances: [ARM * f, ARM * f, (ARM + TIP) * f, ARM * f, ARM * f].map((d) => d * sign),
  };
}

/** 一组节点的包围盒。按节点本身的位置和尺寸算，不把阴影、标签算进去（那样括号会比节点长出一截） */
export function boxOf(nodes: any[]): Box | null {
  if (nodes.length === 0) return null;
  const box: Box = { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity };
  for (const n of nodes) {
    const p = n.position();
    const w = n.outerWidth() / 2;
    const h = n.outerHeight() / 2;
    box.x1 = Math.min(box.x1, p.x - w);
    box.x2 = Math.max(box.x2, p.x + w);
    box.y1 = Math.min(box.y1, p.y - h);
    box.y2 = Math.max(box.y2, p.y + h);
  }
  return box;
}

/** 把每把大括号摆到它罩住的那组节点旁边 */
export function placeBraces(cy: any, list: BraceSpec[], axis: Direction): void {
  for (const s of list) {
    const members = s.all.map((id) => cy.getElementById(id)).filter((n: any) => n.nonempty());
    const box = boxOf(members);
    const endA = cy.getElementById(s.id + "::a");
    const endB = cy.getElementById(s.id + "::b");
    const edge = cy.getElementById(s.id);
    if (!box || endA.empty() || endB.empty() || edge.empty()) continue;
    const shape = braceShape(box, axis, s.side, s.kind);
    endA.position(shape.a);
    endB.position(shape.b);
    edge.style({
      "segment-weights": shape.weights.map((w) => w.toFixed(4)).join(" "),
      "segment-distances": shape.distances.map((d) => d.toFixed(2)).join(" "),
    });
  }
}

/** 往画布里加大括号用的边和两个看不见的锚点 */
export function addBraces(cy: any, list: BraceSpec[]): void {
  for (const s of list) {
    cy.add([
      { group: "nodes", data: { id: s.id + "::a" }, classes: "summary-anchor", grabbable: false, selectable: false },
      { group: "nodes", data: { id: s.id + "::b" }, classes: "summary-anchor", grabbable: false, selectable: false },
      { group: "edges", data: { id: s.id, source: s.id + "::a", target: s.id + "::b", label: "" }, classes: s.kind },
    ]);
  }
}

/** 从 buildElements 的结果里取出大括号 */
export function bracesFrom(els: { group: string; data: Record<string, any>; classes: string }[]): BraceSpec[] {
  return els
    .filter((e) => e.group === "summaries" && (e.data.all ?? []).length > 0)
    .map((e) => ({
      id: e.data.id as string,
      all: e.data.all as string[],
      side: e.data.side === "left" ? ("left" as const) : ("right" as const),
      kind: e.classes === "brace" ? ("brace" as const) : ("summary" as const),
    }));
}
