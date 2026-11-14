import type { FlowBlock } from "./graph";

/** 整篇正文大纲模式：笔记里没有 flow 代码块时，把列表大纲当一张图 */
export const OUTLINE = -1;

export interface Picked {
  index: number;
  /** 存位置用的 id。整篇大纲沿用 "__outline__"，不能改成 "-1"，否则已经存过的位置对不上 */
  diagramId: string;
  source: string;
  /** 内容指纹：变了才需要重画 */
  key: string;
}

/**
 * 侧栏该显示哪张图：光标在哪张 flow 代码块里就显示哪张；
 * 光标不在任何一张里，就留在刚才那张（别因为点了一下标题就跳回第一张）。
 */
export function pickDiagram(
  path: string,
  line: number,
  lastPath: string,
  lastIndex: number,
  blocks: FlowBlock[],
  outline: string,
): Picked {
  let index: number;
  if (blocks.length === 0) {
    index = OUTLINE;
  } else {
    const at = blocks.find((b) => line >= b.start && line <= b.end);
    if (at) index = at.index;
    // 刚才那张还在、且索引没越界就继续显示它
    else index = path === lastPath && lastIndex >= 0 && lastIndex < blocks.length ? lastIndex : 0;
  }
  const diagramId = index === OUTLINE ? "__outline__" : String(index);
  const source = index === OUTLINE ? outline : blocks[index].source;
  return { index, diagramId, source, key: `${path}\u0000${diagramId}\u0000${source}` };
}

export interface GateInput {
  path: string;
  line: number;
  lastPath: string;
  lastLine: number;
  /** 已经画出来的那张图的指纹；空串表示还没画过 */
  shownKey: string;
  /** 内容变过（editor-change 打的标记） */
  dirty: boolean;
  /** 上一趟发现侧栏是收着的 */
  wasHidden: boolean;
  /** 这一趟侧栏是不是可见 */
  visible: boolean;
}

/** idle：什么都不用做；hidden：收着不画，只记状态；work：去解析并渲染 */
export type Gate = "idle" | "hidden" | "work";

/**
 * 这一趟刷新要不要干活。
 * 600ms 一次的轮询走的就是这里：绝大多数时候只花一次 getCursor() 就返回 idle，
 * 不去 getValue() 拿全文、不扫正则。
 */
export function gate(g: GateInput): Gate {
  // 从来没有画过（shownKey 为空）就照常往下走，否则侧栏刚打开时会一直空着
  if (g.shownKey && !g.visible) return "hidden";
  const forced = g.wasHidden || g.dirty || !g.shownKey;
  if (!forced && g.path === g.lastPath && g.line === g.lastLine) return "idle";
  return "work";
}
