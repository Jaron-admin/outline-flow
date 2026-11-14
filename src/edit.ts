// 在图上改笔记的文字规则。全是纯函数：给一篇笔记的全文和要做的操作，返回改完的全文。
// 读写笔记、撤回、重画都不在这里，见 main.ts。
//
// 两种来源，和图的来源一致（见 side.ts 的 pickDiagram）：
// - block：笔记里的第 index 个 flow 代码块，块里每一行都可能是一个节点；
// - outline：没有 flow 代码块时，整篇笔记的标题和列表就是图，段落和别的行不动。
// 行号一律是笔记里的行号（从 0 数）；图上节点自己带的行号是图的源文本里的行号（从 1 数），
// 两者的对应见 diagramSource。

import { t as tr } from "./i18n";
import { HEADING, extractOutlineMap, findFlowBlocks, indentWidth, normalizeOutline } from "./graph";

export type Target = { mode: "outline" } | { mode: "block"; index: number };

/** 存位置用的图 id 对回图的来源：整篇大纲是 "__outline__"，flow 代码块是序号 */
export function targetOf(diagramId: string): Target {
  return diagramId === "__outline__" ? { mode: "outline" } : { mode: "block", index: Number(diagramId) || 0 };
}

/** 图上的操作。line 是节点在图的源文本里的行号（从 1 数，就是节点的 data.line） */
export type EditOp =
  | { kind: "setText"; line: number; text: string }
  | { kind: "addSibling"; line: number; text: string }
  | { kind: "addChild"; line: number; text: string }
  | { kind: "promote"; line: number }
  | { kind: "remove"; line: number };

export interface EditOk {
  ok: true;
  /** 改完的笔记全文 */
  text: string;
  /** 改完之后要选中的节点在笔记里的行号；没有可选的是 null */
  line: number | null;
  /** 要给用户看的一句话（比如删掉了整节） */
  notice?: string;
}
export interface EditNo {
  ok: false;
  reason: string;
}
export type EditResult = EditOk | EditNo;

/** 删掉整节后给用户看的一句话（跟着当前语言走，用的时候才取） */
export const removedSectionNotice = () => tr("edit.removedSection");

const no = (reason: string): EditNo => ({ ok: false, reason });

// ---------- 一行里哪些是节点、节点的字在哪一段 ----------

/** 和 graph.ts 的 stripListMarkers 同一个写法：缩进、列表记号、任务框 */
const MARKER = /^(\s*)(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/;
const LIST_LINE = /^\s*(?:[-*+]|\d+[.)])\s+/;
/** 列表记号本身：记号字、后面的空白、可选的任务框 */
const MARKER_PARTS = /^(\s*)([-*+]|\d+[.)])(\s+)(\[[ xX]\]\s+)?/;

/**
 * 这一行是不是图上的一个节点。注释（//）、概要和收尾（}）、只写了一个 (引用) 的行、
 * 以 { 结尾的容器行都不是，在图上也点不出来，改不了。
 */
export function lineIsNode(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (t.startsWith("//") || t.startsWith("/*") || /^[}｝]/.test(t)) return false;
  if (/\{\s*$/.test(t)) return false;
  const body = t.replace(MARKER, "").trim();
  if (/(?:^|: |：)\s*\([^()]*\)\s*$/.test(body)) return false;
  return true;
}

/** 把行内会被图当成特殊写法的段（代码、链接、双链、<网址>，以及可选的【备注】）换成等长的占位，找冒号和【】时不受它们干扰 */
function mask(s: string, withNote: boolean): string {
  const fill = (m: string) => "_".repeat(m.length);
  let t = s
    .replace(/(`+)(?!`)([\s\S]*?[^`])\1(?!`)/g, fill)
    .replace(/!?\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, fill)
    .replace(/!?\[([^\]]*)\]\(([^)\s]*)(?:\s+"[^"]*")?\)/g, fill)
    .replace(/<((?:https?:\/\/|mailto:)[^\s<>]+)>/gi, fill);
  if (withNote) t = t.replace(/【[^】]*】/g, fill);
  return t;
}

interface Parts {
  /** 缩进、列表记号、任务框；标题是前面的 # 和空格 */
  prefix: string;
  /** 线上的字连同冒号和后面的空白（没有就是空串） */
  head: string;
  /** 节点自己的字 */
  text: string;
  /** 节点的字后面原样留着的：空白、【备注】、标题行尾的 # */
  tail: string;
}

/**
 * 把一行拆成 前缀 + 线上的字 + 节点的字 + 后面的备注。拆法和图的解析一致（见 graph.ts 的 inlineMarkdown 和 buildElements）：
 * 线上的字是第一个没转义的「冒号+空格」或「：」之前的部分，只有有上一级的行才有；标题里的冒号是标题的字；
 * 【备注】从第一个【起一直原样留着。
 * edge：这一行有没有上一级，有才认线上的字。
 */
function splitLine(line: string, heading: boolean, edge: boolean): Parts {
  let prefix: string;
  let rest: string;
  if (heading) {
    const h = HEADING.exec(line)!;
    prefix = /^\s{0,3}#{1,6}\s+/.exec(line)![0];
    rest = h[2];
    const after = line.slice(prefix.length + rest.length);
    const parts = splitNote(rest);
    return { prefix, head: "", text: parts.text, tail: parts.tail + after };
  }
  prefix = MARKER.exec(line)?.[0] ?? /^\s*/.exec(line)![0];
  rest = line.slice(prefix.length);
  let head = "";
  if (edge) {
    // 前面补一个字：真正的解析是对带缩进的整行找的，行首正好是「: 」时缩进那一格算「冒号前面的字」
    const m = /[^\\](: |：)/.exec(" " + mask(rest, true));
    if (m) {
      const end = m.index + m[1].length;
      head = rest.slice(0, end) + /^\s*/.exec(rest.slice(end))![0];
      rest = rest.slice(head.length);
    }
  }
  const parts = splitNote(rest);
  return { prefix, head, text: parts.text, tail: parts.tail };
}

/** 节点的字和后面的【备注】：第一个【之前是字（行尾的空白不算），后面都原样留着 */
function splitNote(rest: string): { text: string; tail: string } {
  const k = mask(rest, false).indexOf("【");
  const body = k < 0 ? rest : rest.slice(0, k);
  const text = body.replace(/\s+$/, "");
  return { text, tail: rest.slice(text.length) };
}

// ---------- 把笔记整理成一串节点 ----------

interface Row {
  /** 笔记里的行号（从 0 数） */
  line: number;
  kind: "heading" | "list" | "plain";
  /** 标题的级别；别的是 0 */
  level: number;
  /** 上一级在 rows 里的位置；没有是 -1 */
  parent: number;
  indent: string;
  /** 这一行有没有上一级（决定认不认线上的字） */
  edge: boolean;
}

interface Model {
  mode: "block" | "outline";
  lines: string[];
  /** 有效的行数：全文以换行结尾时最后那个空串不算一行 */
  effLen: number;
  rows: Row[];
  byLine: Map<number, number>;
  /** 代码块的范围（含头不含尾）；整篇大纲是整篇 */
  from: number;
  to: number;
  /** 代码块里有 # 标题：行的层级由标题说了算，只支持改字 */
  hasHeading: boolean;
}

const leading = (s: string) => /^\s*/.exec(s)![0];

/** 一行缩进多宽：整篇大纲和图的解析（normalizeOutline）一样 Tab 算 4 格；代码块里按字数，和 graph-selector 一样 */
function widthOf(model: Model, line: string): number {
  return model.mode === "outline" ? indentWidth(line) : leading(line).length;
}

function buildModel(text: string, target: Target): Model | null {
  const lines = text.split("\n");
  const effLen = lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;
  const rows: Row[] = [];
  const stack: { depth: number; row: number }[] = [];
  if (target.mode === "outline") {
    const { source, lines: map } = extractOutlineMap(text);
    source.split("\n").forEach((s, i) => {
      if (!s) return;
      const line = map[i];
      const depth = leading(s).length / 2;
      while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
      const h = HEADING.exec(lines[line]);
      rows.push({
        line,
        kind: h ? "heading" : "list",
        level: h ? h[1].length : 0,
        parent: stack.length ? stack[stack.length - 1].row : -1,
        indent: h ? "" : leading(lines[line]),
        edge: depth > 0,
      });
      stack.push({ depth, row: rows.length - 1 });
    });
    return finish({ mode: "outline", lines, effLen, rows, byLine: new Map(), from: 0, to: effLen, hasHeading: false });
  }
  const block = findFlowBlocks(text)[target.index];
  if (!block) return null;
  const from = block.start + 1;
  const to = from + (block.source === "" ? 0 : block.source.split("\n").length);
  const hasHeading = lines.slice(from, to).some((l) => HEADING.test(l));
  for (let line = from; line < to; line++) {
    if (!lineIsNode(lines[line])) continue;
    const indent = leading(lines[line]);
    while (stack.length && stack[stack.length - 1].depth >= indent.length) stack.pop();
    const h = HEADING.exec(lines[line]);
    rows.push({
      line,
      kind: h ? "heading" : LIST_LINE.test(lines[line]) ? "list" : "plain",
      level: h ? h[1].length : 0,
      parent: stack.length ? stack[stack.length - 1].row : -1,
      indent,
      // 有标题时层级是按标题重排的，这里只能说「大概有上一级」
      edge: hasHeading ? !h : indent.length > 0,
    });
    stack.push({ depth: indent.length, row: rows.length - 1 });
  }
  return finish({ mode: "block", lines, effLen, rows, byLine: new Map(), from, to, hasHeading });
}

function finish(m: Model): Model {
  m.rows.forEach((r, i) => m.byLine.set(r.line, i));
  return m;
}

/**
 * 图的源文本，以及它每一行对应笔记里的哪一行（lines[i] 是第 i 行，从 0 数）。
 * 和 main.ts 里侧栏、代码块拿去画图的那份源文本是同一份，所以能拿来核对「图是不是跟得上笔记」。
 */
export function diagramSource(text: string, target: Target): { source: string; lines: number[] } | null {
  const t = text.replace(/\r\n/g, "\n");
  if (target.mode === "outline") return extractOutlineMap(t);
  const block = findFlowBlocks(t)[target.index];
  if (!block) return null;
  const count = block.source === "" ? 0 : block.source.split("\n").length;
  return { source: block.source, lines: Array.from({ length: count }, (_, i) => block.start + 1 + i) };
}

const norm = (s: string) => s.replace(/\s+$/, "");

/** 一个节点连同它下面的整棵子树，到哪一行为止（含）。标题是整节（到下一个同级或更高的标题之前），别的看缩进 */
function lastLineOf(m: Model, i: number): number {
  const r = m.rows[i];
  if (r.kind === "heading" && m.mode === "outline") return trimBlank(m, r.line, sectionEnd(m, i) - 1);
  const w = widthOf(m, m.lines[r.line]);
  let last = r.line;
  for (let l = r.line + 1; l < m.to; l++) {
    if (!m.lines[l].trim()) continue;
    if (widthOf(m, m.lines[l]) > w) last = l;
    else break;
  }
  return last;
}

/** 从 to 往上跳过空行，最少停在 from */
function trimBlank(m: Model, from: number, to: number): number {
  let l = Math.min(to, m.effLen - 1);
  while (l > from && !m.lines[l].trim()) l--;
  return Math.max(l, from);
}

/** 标题这一节到哪里结束（不含）：下一个同级或更高的标题，没有就到文末 */
function sectionEnd(m: Model, i: number): number {
  const level = m.rows[i].level;
  for (let j = i + 1; j < m.rows.length; j++) {
    if (m.rows[j].kind === "heading" && m.rows[j].level <= level) return m.rows[j].line;
  }
  return m.effLen;
}

/** 标题自己的内容到哪里结束（不含）：下一个标题（不管几级），没有就到文末 */
function directEnd(m: Model, i: number): number {
  for (let j = i + 1; j < m.rows.length; j++) if (m.rows[j].kind === "heading") return m.rows[j].line;
  return m.effLen;
}

/** 这一行有没有字、有的话每一段在哪里 */
function partsOf(m: Model, i: number): Parts {
  const r = m.rows[i];
  return splitLine(m.lines[r.line], r.kind === "heading", r.edge);
}

/** 一行的列表记号拆开：缩进、记号字、后面的空白、任务框 */
function markerOf(line: string) {
  const m = MARKER_PARTS.exec(line);
  if (!m) return null;
  const num = /^(\d+)([.)])$/.exec(m[2]);
  return { indent: m[1], mark: m[2], gap: m[3], box: m[4] ?? "", num: num ? Number(num[1]) : null, delim: num ? num[2] : "" };
}

/** 同级新行的记号：圆点沿用，编号 +1，有任务框的新行也带一个没勾的框；没有记号就是没有 */
function siblingMarker(line: string): string {
  const mk = markerOf(line);
  if (!mk) return "";
  const box = mk.box ? "[ ]" + (/\s+$/.exec(mk.box)?.[0] ?? " ") : "";
  return (mk.num === null ? mk.mark : `${mk.num + 1}${mk.delim}`) + mk.gap + box;
}

/** 第一个子节点的记号：圆点沿用（不带任务框），编号的下一级用圆点 */
function childMarker(line: string): string {
  const mk = markerOf(line);
  if (!mk) return "";
  return (mk.num === null ? mk.mark : "-") + mk.gap;
}

/** 缩进一级用什么：有 Tab 就 Tab；不然是已有的「子比父多缩进几格」里最小的；都没有就按父行记号的宽度（至少 2 格） */
function unitOf(m: Model, parentLine: string): string {
  if (m.rows.some((r) => r.kind !== "heading" && r.indent.includes("\t"))) return "\t";
  let step = Infinity;
  for (const r of m.rows) {
    if (r.kind === "heading" || r.parent < 0 || m.rows[r.parent].kind === "heading") continue;
    const d = widthOf(m, m.lines[r.line]) - widthOf(m, m.lines[m.rows[r.parent].line]);
    if (d > 0 && d < step) step = d;
  }
  if (Number.isFinite(step)) return " ".repeat(step);
  if (m.mode === "block") return "  ";
  const mk = markerOf(parentLine);
  return " ".repeat(Math.max(2, mk ? mk.mark.length + mk.gap.length : 2));
}

/** 把一段行的缩进从 from 换成 to（多出来的缩进原样留着）；缩进比 from 浅的行尽量少剥 */
function reindent(lines: string[], from: string, to: string): string[] {
  return lines.map((l) => {
    if (!l.trim()) return l;
    const ws = leading(l);
    if (ws.startsWith(from)) return to + l.slice(from.length);
    return l.slice(Math.min(ws.length, from.length - to.length));
  });
}

// ---------- 取一个节点的原文 ----------

/** 编辑框里显示的字：节点的原文，不含线上的字、不含【备注】。这一行不是节点就是 null */
export function rawNodeText(text: string, target: Target, line: number): string | null {
  const m = buildModel(text.replace(/\r\n/g, "\n"), target);
  const i = m?.byLine.get(line);
  if (!m || i === undefined) return null;
  return partsOf(m, i).text;
}

// ---------- 各种操作 ----------

const eol = (text: string, crlf: boolean) => (crlf ? text.replace(/\n/g, "\r\n") : text);
const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

function join(lines: string[]): string {
  return lines.join("\n");
}

/** 改节点的字。字没变就原样返回（line 照给，text 不变） */
export function setNodeText(text: string, target: Target, line: number, newText: string): EditResult {
  return run(text, (t) => {
    const m = buildModel(t, target);
    const i = m?.byLine.get(line);
    if (!m || i === undefined) return no(tr("edit.noRow"));
    const value = oneLine(newText);
    if (!value) return no(tr("edit.emptyText"));
    const p = partsOf(m, i);
    if (value === p.text) return { ok: true, text: t, line };
    m.lines[line] = p.prefix + p.head + value + p.tail;
    return { ok: true, text: join(m.lines), line };
  });
}

/** 在节点后面（连它整棵子树之后）加一个同级节点 */
export function addSibling(text: string, target: Target, line: number, newText: string): EditResult {
  return run(text, (t) => {
    const m = buildModel(t, target);
    const i = m?.byLine.get(line);
    if (!m || i === undefined) return no(tr("edit.noRow"));
    const value = oneLine(newText);
    if (!value) return no(tr("edit.emptyText"));
    const r = m.rows[i];
    if (m.mode === "block" && m.hasHeading) return no(tr("edit.headingInBlockAdd"));
    if (r.kind === "heading") {
      // 同级标题：放在这一整节后面。上一行不是空行就先补一个空行
      const at = trimBlank(m, r.line, sectionEnd(m, i) - 1);
      const add = m.lines[at].trim() ? ["", "#".repeat(r.level) + " " + value] : ["#".repeat(r.level) + " " + value];
      m.lines.splice(at + 1, 0, ...add);
      return { ok: true, text: join(m.lines), line: at + add.length };
    }
    const at = lastLineOf(m, i);
    m.lines.splice(at + 1, 0, r.indent + siblingMarker(m.lines[r.line]) + value);
    return { ok: true, text: join(m.lines), line: at + 1 };
  });
}

/** 在节点下面加一个子节点，放在它所有子节点的最后 */
export function addChild(text: string, target: Target, line: number, newText: string): EditResult {
  return run(text, (t) => {
    const m = buildModel(t, target);
    const i = m?.byLine.get(line);
    if (!m || i === undefined) return no(tr("edit.noRow"));
    const value = oneLine(newText);
    if (!value) return no(tr("edit.emptyText"));
    const r = m.rows[i];
    if (m.mode === "block" && m.hasHeading) return no(tr("edit.headingInBlockAdd"));
    if (r.kind === "heading") {
      // 标题下面加列表项：放在标题自己的内容末尾、第一个小标题之前；上一行不是列表就先补一个空行
      const end = directEnd(m, i);
      const at = trimBlank(m, r.line, end - 1);
      const kids = m.rows.filter((k, j) => k.parent === i && k.kind === "list" && j > i);
      const last = kids[kids.length - 1];
      const indent = last ? last.indent : "";
      const marker = last ? siblingMarker(m.lines[last.line]) : "- ";
      const prev = m.lines[at];
      const needBlank = !!prev.trim() && !LIST_LINE.test(prev) && !/^\s/.test(prev);
      const add = (needBlank ? [""] : []).concat(indent + marker + value);
      m.lines.splice(at + 1, 0, ...add);
      return { ok: true, text: join(m.lines), line: at + add.length };
    }
    const kids = m.rows.filter((k) => k.parent === i && k.kind !== "heading");
    const last = kids[kids.length - 1];
    const at = lastLineOf(m, i);
    const indent = last ? last.indent : r.indent + unitOf(m, m.lines[r.line]);
    const marker = last ? siblingMarker(m.lines[last.line]) : childMarker(m.lines[r.line]);
    m.lines.splice(at + 1, 0, indent + marker + value);
    return { ok: true, text: join(m.lines), line: at + 1 };
  });
}

/** 提一级：节点连同它的子树，变成它上一级节点后面的同级（它上一级的其余子节点不动） */
export function promote(text: string, target: Target, line: number): EditResult {
  return run(text, (t) => {
    const m = buildModel(t, target);
    const i = m?.byLine.get(line);
    if (!m || i === undefined) return no(tr("edit.noRow"));
    const r = m.rows[i];
    if (m.mode === "block" && m.hasHeading) return no(tr("edit.headingInBlockEdit"));
    if (r.kind === "heading") return no(tr("edit.promoteHeading"));
    if (r.parent < 0 || m.rows[r.parent].kind === "heading") return no(tr("edit.topLevel"));
    const p = m.rows[r.parent];
    const last = lastLineOf(m, i);
    const moved = m.lines.splice(r.line, last - r.line + 1);
    // 先拿掉再量上一级的末尾：它的子树少了这一段（上一级自己在拿走的这段之前，行号没变）
    m.effLen -= moved.length;
    m.to -= moved.length;
    const pEnd = lastLineOf(m, r.parent);
    m.lines.splice(pEnd + 1, 0, ...reindent(moved, r.indent, p.indent));
    return { ok: true, text: join(m.lines), line: pEnd + 1 };
  });
}

/** 删节点连同整棵子树（标题是整节）。接着选中的是后一个同级，没有就前一个同级，再没有就上一级 */
export function removeNode(text: string, target: Target, line: number): EditResult {
  return run(text, (t) => {
    const m = buildModel(t, target);
    const i = m?.byLine.get(line);
    if (!m || i === undefined) return no(tr("edit.noRow"));
    const r = m.rows[i];
    if (m.mode === "block" && m.hasHeading) return no(tr("edit.headingInBlockEdit"));
    const isSection = r.kind === "heading";
    let start = r.line;
    const end = isSection ? sectionEnd(m, i) : lastLineOf(m, i) + 1; // 不含
    const sibs = m.rows.flatMap((k, j) => (k.parent === r.parent ? [j] : []));
    const at = sibs.indexOf(i);
    const next = sibs[at + 1];
    const prev = sibs[at - 1];
    if (isSection && end >= m.effLen) {
      // 删到文末：它前面隔开的空行也一并去掉，免得文末堆着空行
      while (start > 0 && !m.lines[start - 1].trim()) start--;
    }
    const removed = end - start;
    m.lines.splice(start, removed);
    let pick: number | null = null;
    if (next !== undefined) pick = m.rows[next].line - removed;
    else if (prev !== undefined) pick = m.rows[prev].line;
    else if (r.parent >= 0) pick = m.rows[r.parent].line;
    return { ok: true, text: join(m.lines), line: pick, ...(isSection ? { notice: removedSectionNotice() } : {}) };
  });
}

/** 统一处理换行符：全文里有 \r\n 的话，先当 \n 改，改完再换回去 */
function run(text: string, fn: (t: string) => EditResult): EditResult {
  const crlf = text.includes("\r\n");
  const r = fn(crlf ? text.replace(/\r\n/g, "\n") : text);
  return r.ok ? { ...r, text: eol(r.text, crlf) } : r;
}

// ---------- 图上的操作 → 笔记 ----------

export interface Applied {
  ok: true;
  /** 改完的笔记全文 */
  text: string;
  /** 改完要选中的节点：在笔记里的行号 */
  line: number | null;
  /** 改完要选中的节点：在改完之后图的源文本里的行号（从 1 数）；图上没有对应节点是 null */
  srcLine: number | null;
  /** 改完之后图的源文本，重画时拿它核对 */
  source: string;
  notice?: string;
}

/**
 * 把图上的一个操作落到笔记全文上。
 * source 是图现在显示的源文本：笔记已经变得和它对不上（比如你正好在编辑器里打了字，图还没来得及跟上）时不动手，
 * 免得行号对错了位置，把别的行改掉。
 */
export function applyEdit(text: string, target: Target, source: string, op: EditOp): Applied | EditNo {
  const ds = diagramSource(text, target);
  if (!ds) return no(tr("edit.diagramGone"));
  if (norm(ds.source) !== norm(source)) return no(tr("edit.noteChanged"));
  const line = ds.lines[op.line - 1];
  if (line === undefined) return no(tr("edit.noRow"));
  let r: EditResult;
  switch (op.kind) {
    case "setText":
      r = setNodeText(text, target, line, op.text);
      break;
    case "addSibling":
      r = addSibling(text, target, line, op.text);
      break;
    case "addChild":
      r = addChild(text, target, line, op.text);
      break;
    case "promote":
      r = promote(text, target, line);
      break;
    case "remove":
      r = removeNode(text, target, line);
      break;
  }
  if (!r.ok) return r;
  return { ok: true, text: r.text, line: r.line, notice: r.notice, ...locate(r.text, target, r.line) };
}

/** 改完以后，笔记里的某一行在图的源文本里是第几行 */
export function locate(text: string, target: Target, line: number | null): { srcLine: number | null; source: string } {
  const ds = diagramSource(text, target);
  if (!ds) return { srcLine: null, source: "" };
  const at = line === null ? -1 : ds.lines.indexOf(line);
  return { srcLine: at < 0 ? null : at + 1, source: ds.source };
}

/** 图的源文本对得上笔记里现在的内容吗（只看末尾空白以外的部分） */
export function sourceMatches(text: string, target: Target, source: string): boolean {
  const ds = diagramSource(text, target);
  return !!ds && norm(ds.source) === norm(source);
}

/** 读一个节点的原文，同样先核对图跟得上笔记 */
export function readNodeText(text: string, target: Target, source: string, srcLine: number): string | null {
  const ds = diagramSource(text, target);
  if (!ds || norm(ds.source) !== norm(source)) return null;
  const line = ds.lines[srcLine - 1];
  return line === undefined ? null : rawNodeText(text, target, line);
}

// ---------- 撤回用：两段文字之间最小的一处改动 ----------

/** 把 a 变成 b 只需要改中间一段：返回 a 里要换掉的范围 [from, to) 和换成的文字。写进编辑器时只动这一段，光标不会被甩开 */
export function diffRange(a: string, b: string): { from: number; to: number; insert: string } {
  let s = 0;
  const max = Math.min(a.length, b.length);
  while (s < max && a.charCodeAt(s) === b.charCodeAt(s)) s++;
  let e = 0;
  while (e < max - s && a.charCodeAt(a.length - 1 - e) === b.charCodeAt(b.length - 1 - e)) e++;
  return { from: s, to: a.length - e, insert: b.slice(s, b.length - e) };
}

// ---------- 方向键在节点之间走 ----------

export interface TreeLinks {
  parent: number | null;
  prev: number | null;
  next: number | null;
  first: number | null;
}

/**
 * 按图的源文本的缩进，给每个节点理出上一级、前一个同级、后一个同级、第一个子节点（都用源文本的行号，从 1 数）。
 * nodeLines 是图上真有的、能点的节点所在的行；别的行（概要、注释）不参与。
 * 层级的算法和图的解析一致：有 # 标题时先按标题重排，上一级是前面最近的、缩进更浅的那个节点。
 */
export function sourceTree(source: string, nodeLines: number[]): Map<number, TreeLinks> {
  const raw = source.split("\n");
  const lines = raw.some((l) => HEADING.test(l)) ? normalizeOutline(raw, true) : raw;
  const out = new Map<number, TreeLinks>();
  const stack: { line: number; indent: number }[] = [];
  const lastKid = new Map<number | null, number>();
  for (const line of [...nodeLines].sort((a, b) => a - b)) {
    const indent = leading(lines[line - 1] ?? "").length;
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const parent = stack.length ? stack[stack.length - 1].line : null;
    const prev = lastKid.get(parent) ?? null;
    out.set(line, { parent, prev, next: null, first: null });
    if (prev !== null) out.get(prev)!.next = line;
    else if (parent !== null) out.get(parent)!.first = line;
    lastKid.set(parent, line);
    stack.push({ line, indent });
  }
  return out;
}
