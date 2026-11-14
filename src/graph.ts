import { parse } from "graph-selector";
import { t as tr } from "./i18n";
import type { Structure } from "./themes";

export interface FlowElement {
  /** warnings 不进画布：写法有问题时给用户看的一句话，见 data.text */
  group: "nodes" | "edges" | "summaries" | "warnings";
  data: Record<string, any>;
  classes: string;
}

/**
 * 去掉每行开头的列表记号（- * + 1. 以及任务框），缩进保留。
 * 这样普通的 Markdown 大纲也能直接当流程图的源文本。
 */
export function stripListMarkers(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/^(\s*)(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, "$1"))
    .join("\n");
}

/**
 * 把节点文字里的全角括号（中文习惯的补充说明，如「仓库（含备用）」）自动转义成 \（ \）。
 * graph-selector 会把 () 和 （） 都当成「引用节点」，导致报错；加反斜杠转义后就当普通文字显示。
 * 幂等：如果全角括号前面已经有反斜杠（用户手打过转义），就不再重复加，避免双重转义残留。
 * 半角 () 保持不动，继续当回路引用（如 (提交采购申请)）。
 */
export function escapeFullwidthParens(text: string): string {
  return text.replace(/(?<!\\)（/g, "\\（").replace(/(?<!\\)）/g, "\\）");
}

/**
 * 从一行文字里把「【备注】」摘出来当备注（note），剩下的当节点文字。
 * 【】 不是 graph-selector 的特殊符号，本来会原样留在 label 里；这里在解析前摘掉，
 * 让备注显示成节点旁边的小字，而不是挤在节点文字里。
 */
export function extractBracketNote(line: string): { text: string; note: string } {
  const found = [...line.matchAll(/【([^】]*)】/g)].map((m) => m[1].trim()).filter(Boolean);
  if (found.length === 0 && !/【[^】]*】/.test(line)) return { text: line, note: "" };
  // 一行里写了几个【】就都留着，用分号连起来；以前只留第一个，后面的会悄悄丢掉。
  // 只去掉摘备注后行尾的空格，保留行首缩进（缩进决定父子层级，不能 trim 掉）
  return { text: line.replace(/【[^】]*】/g, "").replace(/\s+$/, ""), note: found.join("；") };
}

/**
 * 给 flowchart.fun 用的文本：去列表记号，Tab 换成两个空格，全角括号转义。
 * 概要行 `} 组名` 要转成注释：flowchart.fun 的解析器不认 }，会把 "组名" 当成图上一个多出来的节点。
 * 【备注】原样留着——那个网站没有备注这回事，留在正文里至少看得见。
 */
export function toFlowchartFun(text: string): string {
  return (
    stripListMarkers(text)
      .split("\n")
      .map((line) => line.replace(/^\s+/, (ws) => ws.replace(/\t/g, "  ")))
      .map((line) => {
        const sum = parseSummary(line);
        if (sum) return `${sum.indent}// ${sum.text || (sum.count ? tr("summary.previous", { count: sum.count }) : tr("summary.plain"))}`;
        return escapeFullwidthParens(line);
      })
      .join("\n")
      .trim() + "\n"
  );
}

/** 流程图写法里有特殊意思的字：冒号（线上的字）、括号（引用）、花括号（容器）、方括号（属性）、# 和 .（编号、类名）、/（注释） */
const SPECIAL = /(?<!\\)([:：()（）{}[\]#./])/g;

/** 把一段字里所有有特殊意思的字都加上反斜杠，让解析器原样当字显示 */
export function literal(text: string): string {
  // 解析器会把「\n」两个字换成换行；代码里的 C:\new 这种不能断开，中间塞一个看不见的字
  return text.replace(SPECIAL, "\\$1").replace(/\\n/g, "\\\u200bn");
}

/**
 * 一行里的链接：text 是显示的字，url 是点了去的地址。
 * kind 是 url（网址）或 note（Obsidian 双链）；双链的 url 存的是链接路径，
 * 比如「笔记名」「笔记名#标题」，别名只影响 text。
 */
export interface LinkInfo {
  kind: "url" | "note";
  text: string;
  url: string;
}

/** 链接地址只认这三种开头，别的（相对路径、javascript: 之类）一律只当字 */
const LINK_SCHEME = /^(?:https?:|mailto:)/i;

/**
 * 直接写的网址：http(s):// 开头，到空白、尖括号、引号、中文标点为止。
 * 排除 \u0000：它是被摘出去的字的占位符，不是网址的一部分。
 */
const BARE_URL = /https?:\/\/[^\s\u0000<>"，。；：！？、）】」』》〉（【「『《〈“”‘’…　]+/gi;

/** 去掉网址末尾不属于网址的字：句号逗号、没配对的右括号、加粗斜体的记号 */
function trimUrlEnd(url: string): string {
  let u = url;
  for (;;) {
    const last = u[u.length - 1];
    if (last && ".,;:!?'*_~".includes(last)) u = u.slice(0, -1);
    else if (last === ")" && (u.match(/\)/g) ?? []).length > (u.match(/\(/g) ?? []).length) u = u.slice(0, -1);
    else if (last === "]" && (u.match(/\]/g) ?? []).length > (u.match(/\[/g) ?? []).length) u = u.slice(0, -1);
    else return u;
  }
}

/**
 * 把一行里的 Markdown 行内写法换成图上能显示的纯文字：
 * **加粗**、*斜体*、~~删除线~~、==高亮== 去掉记号；`代码`、[链接](地址)、[[双链|别名]] 只留看得见的字，
 * 而且这些字原样显示（代码里的冒号、括号不会被当成流程图写法）。
 * 网址（[字](http…)、<http…>、直接写的 http…）也原样显示，同时记进 links（kind 是 url），图上 ⌘+单击节点就能打开；
 * [[双链]]（含 [[笔记|别名]]、[[笔记#标题]]）同样记进 links（kind 是 note）；图片和 ![[嵌入]] 不算链接。
 * noteLinks 给 false 时双链不记链接，只当普通文字（导出的网页里没有 Obsidian，点不开）。
 * strong：整个节点的字都是加粗的（线上的字不算），图上用粗体画。
 */
export function inlineMarkdown(text: string, noteLinks = true): { text: string; strong: boolean; links: LinkInfo[] } {
  const kept: string[] = [];
  const links: LinkInfo[] = [];
  const hold = (t: string) => `\u0000${kept.push(literal(t)) - 1}\u0000`;
  const holdLink = (label: string, url: string, kind: "url" | "note" = "url") => {
    if (!links.some((l) => l.url === url && l.kind === kind)) links.push({ kind, text: label, url });
    return hold(label);
  };
  let t = text
    .replace(/(`+)(?!`)([\s\S]*?[^`])\1(?!`)/g, (_m, _b, c: string) => hold(c.trim()))
    .replace(/(!?)\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (_m, bang: string, f: string, a?: string) => {
      const label = a?.trim() || f.trim();
      return !bang && noteLinks ? holdLink(label, f.trim(), "note") : hold(label);
    })
    .replace(/!?\[([^\]]*)\]\(([^)\s]*)(?:\s+"[^"]*")?\)/g, (m: string, a: string, u: string) => {
      const label = a.trim() || u;
      return !m.startsWith("!") && LINK_SCHEME.test(u) ? holdLink(label, u) : hold(label);
    })
    .replace(/<((?:https?:\/\/|mailto:)[^\s<>\u0000]+)>/gi, (_m, u: string) => holdLink(u, u))
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/?(?:b|strong|i|em|u|s|mark|span|font|sup|sub|code)\b[^>]*>/gi, "")
    .replace(BARE_URL, (m: string, at: number, all: string) => {
      let url = trimUrlEnd(m);
      // ==http…== 高亮：末尾的 == 是记号，不是网址
      if (all.slice(Math.max(0, at - 2), at) === "==" && url.endsWith("==")) url = url.slice(0, -2);
      return url ? holdLink(url, url) + m.slice(url.length) : m;
    });
  // 线上的字（第一个「冒号+空格」之前）不算进节点的字
  const cut = t.search(/[^\\](?:: |：)/);
  const body = cut > -1 ? t.slice(cut + 2) : t;
  const strong = /^\s*(\*\*|__)(?=\S)[\s\S]*?\S\1\s*$/.test(body);
  t = t
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2")
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, "$1")
    .replace(/==(?=\S)([\s\S]*?\S)==/g, "$1")
    .replace(/(^|[^\w*\\])\*(?=\S)([^*]*?\S)\*(?![\w*])/g, "$1$2")
    .replace(/(^|[^\w\\])_(?=\S)([^_]*?\S)_(?!\w)/g, "$1$2")
    // Obsidian 的中文标签（#重要）不是节点编号，原样显示；英文的 #id 仍按流程图写法
    .replace(/(^|\s)#(?![\w-])/g, "$1\\#")
    .replace(/\u0000(\d+)\u0000/g, (_m, i: string) => kept[+i]);
  return { text: t, strong, links };
}

/**
 * 半角括号只有「整个节点就是一个 (名字)」时才是引用；和别的字混在一起（「改成 (300 = 5 分钟)」）就是普通括号，
 * 原样当字显示。最外层的行没有上一级，冒号也不可能是线上的字，一并当字。
 */
export function plainWhereObvious(line: string): string {
  const indent = /^\s*/.exec(line)![0];
  let rest = line.slice(indent.length);
  if (!indent) rest = rest.replace(/(?<!\\)(: |：)/g, "\\$1");
  const cut = rest.search(/[^\\](?:: |：)/);
  const head = cut > -1 ? rest.slice(0, cut + 2) : "";
  let body = cut > -1 ? rest.slice(cut + 2) : rest;
  if (/(?<!\\)[()]/.test(body) && !/^\s*\([^()]*\)\s*$/.test(body)) body = body.replace(/(?<!\\)([()])/g, "\\$1");
  return indent + head + body;
}

/** 解析器报错时给人看的原因（graph-selector 的错误码 → 一句话） */
function reasonOf(code: string | undefined): string {
  switch (code) {
    case "EDGE_LABEL_WITHOUT_PARENT":
      return tr("warn.reason.edgeLabelNoParent");
    case "MULTIPLE_POINTERS_ON_SAME_LINE":
    case "NODE_AND_POINTER_ON_SAME_LINE":
    case "POINTER_AND_CONTAINER_ON_SAME_LINE":
      return tr("warn.reason.pointer");
    case "DUPLICATE_NODE_ID":
    case "DUPLICATE_EDGE_ID":
      return tr("warn.reason.duplicateId");
    default:
      return tr("warn.reason.default");
  }
}

/** Markdown 标题：1 到 6 个 #，后面跟空格。`#标签` 这种紧挨着的不算 */
export const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+/;

/** 一行开头的空白有多宽，Tab 算 4 格 */
export function indentWidth(line: string): number {
  let w = 0;
  for (const ch of line) {
    if (ch === " ") w += 1;
    else if (ch === "\t") w += 4 - (w % 4);
    else break;
  }
  return w;
}

/**
 * 把「标题 + 列表」统一成按两格缩进的大纲，返回的行数和输入一样（不要的行变成空行）。
 * - `#` 到 `######` 是层级：下一级标题挂在上一级下面，跳级（# 直接到 ###）也按挂在最近的上级算。
 * - 标题下面的列表整体挂在这个标题下面，列表自己的缩进照原样换算成层级。
 * - keepPlain：普通文字行要不要留（flow 代码块里要，整篇笔记里只要标题和列表）。
 */
export function normalizeOutline(lines: string[], keepPlain: boolean): string[] {
  const heads: number[] = []; // 当前打开的标题级别
  let indents: number[] = []; // 当前标题下，列表各层的缩进宽度
  return lines.map((line) => {
    const h = HEADING.exec(line);
    if (h) {
      const level = h[1].length;
      while (heads.length && heads[heads.length - 1] >= level) heads.pop();
      const depth = heads.length;
      heads.push(level);
      indents = [];
      // 标题里的冒号是标题的一部分，不是「线上的字」
      return "  ".repeat(depth) + h[2].replace(/(?<!\\)(: |：)/g, "\\$1");
    }
    if (!line.trim()) return "";
    if (!keepPlain && !LIST_ITEM.test(line)) return "";
    const w = indentWidth(line);
    while (indents.length && w < indents[indents.length - 1]) indents.pop();
    if (!indents.length || w > indents[indents.length - 1]) indents.push(w);
    return "  ".repeat(heads.length + indents.length - 1) + line.trimStart();
  });
}

/**
 * 从一篇 Markdown 笔记里，把大纲抽出来当流程图的源文本：
 * `#` 标题和列表行（- * + 数字 以及任务框）都算，标题是上一级、它下面的列表挂在它底下。
 * 普通段落、空行、围栏代码块、引用块、分隔线、开头的属性区都跳过。
 * 这样就能把整篇笔记的正文大纲直接渲染成图，不用再单独写 flow 代码块。
 */
export function extractOutlineFromMarkdown(text: string): string {
  return extractOutlineMap(text).source;
}

/**
 * 和 extractOutlineFromMarkdown 一样抽大纲，另外说明每一行是笔记里的哪一行：
 * lines[i] 是大纲第 i 行（从 0 数）在笔记里的行号（从 0 数）。图上节点的行号对回笔记就靠它。
 */
export function extractOutlineMap(text: string): { source: string; lines: number[] } {
  const lines = text.split("\n");
  const kept: string[] = [];
  const keptAt: number[] = [];
  let inFence = false;
  lines.forEach((raw, i) => {
    const line = raw.replace(/\s+$/, "");
    // 开头的属性区（--- 包起来的 YAML）跳过
    if (i === 0 && line === "---") inFence = true;
    else if (inFence && line === "---" && !kept.length) {
      inFence = false;
      return;
    }
    // 围栏代码块（``` 或 ~~~）整段跳过
    if (/^\s*(`{3,}|~{3,})/.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    if (HEADING.test(line) || LIST_ITEM.test(line)) {
      kept.push(line);
      keptAt.push(i);
    }
  });
  const out: string[] = [];
  const map: number[] = [];
  normalizeOutline(kept, false).forEach((l, k) => {
    if (!l.trim()) return; // 没有字的标题整行丢掉
    out.push(l);
    map.push(keptAt[k]);
  });
  return { source: out.join("\n"), lines: map };
}

/**
 * 概要行：`}`、`} 概要`、`}:2 概要`。`}` 后面必须是行尾、空白或 `:数字`——
 * 「}文字」这种紧挨着的不算概要，免得一个以 } 开头的节点被整个吞掉。
 * 中文输入法下容易打成全角，所以 `｝`、`：` 也认，冒号和数字两边有没有空格都行：
 * `}：2 概要`、`} : 2 概要`、`}:2概要` 都是「括最后 2 个」。
 */
const SUMMARY_LINE = /^(\s*)[}｝](?:\s*[:：]\s*(\d+)\s*(.*?)|\s+(\d+)(?:\s+(.*?))?|\s+(.*?))?\s*$/;

/**
 * 读一行概要。数字有两种写法，都是「括最后几个」：
 * `}:4 密测`（Mind Elixir 的写法）和 `} 4 密测`（数字和字之间隔一个空格）。
 * `} 4个要点` 这种数字紧挨着字的，整串都是概要的字。
 */
export function parseSummary(line: string): { indent: string; count: number; text: string } | null {
  const m = SUMMARY_LINE.exec(line);
  if (!m) return null;
  const count = m[2] ?? m[4];
  return { indent: m[1], count: count ? parseInt(count, 10) : 0, text: (m[3] ?? m[5] ?? m[6] ?? "").trim() };
}
/** 只写了一个 `}`、没有字的概要：解析时先用这个名字占位，画的时候是一个看不见的点 */
const GHOST = "__of_brace__";

interface Tree {
  byId: Map<string, FlowElement>;
  /** 父 -> 子，按行号排好；概要节点也在里面（排版时单独处理） */
  kids: Map<string, FlowElement[]>;
  roots: FlowElement[];
  /** 子节点 id -> 连进来的那条缩进线 */
  edgeTo: Map<string, FlowElement>;
}

const isSummary = (n: FlowElement | undefined) => !!n && n.classes.split(" ").includes("summary-node");

/**
 * 「关联的靠近排」：同一个父节点下的兄弟换先后，让虚线（引用）两头挨得近。
 * 不靠猜：每次把一个兄弟挪到这一组里的另一个位置，整张重新排一遍，量所有虚线两头隔了几排几列，
 * 总数变小了才留下这次挪动，否则挪回去。所有组轮两遍。只有真的变短才会动，所以不会比不开更乱。
 * 有概要（}）的那一组不动：概要括的是连续的几个兄弟，打乱了括号就不对了。
 */
function pullRelated(tree: Tree, refs: FlowElement[], run: () => void): void {
  if (refs.length === 0) return;
  const { kids, byId } = tree;
  const cost = () => {
    let c = 0;
    for (const e of refs) {
      const a = byId.get(e.data.source as string);
      const b = byId.get(e.data.target as string);
      if (!a || !b) continue;
      c += Math.abs((a.data.row as number) - (b.data.row as number)) + 0.5 * Math.abs((a.data.col as number) - (b.data.col as number));
    }
    return c;
  };
  run();
  let best = cost();
  for (let round = 0; round < 2; round++) {
    let improved = false;
    for (const pid of [...kids.keys()]) {
      const list = kids.get(pid)!;
      if (list.length < 2 || list.some((k) => isSummary(k))) continue;
      for (let i = 0; i < list.length; i++) {
        for (let j = 0; j < list.length; j++) {
          if (i === j) continue;
          const cur = kids.get(pid)!;
          const next = cur.slice();
          const [m] = next.splice(i, 1);
          next.splice(j, 0, m);
          kids.set(pid, next);
          run();
          const c = cost();
          if (c < best - 1e-6) {
            best = c;
            improved = true;
          } else kids.set(pid, cur);
        }
      }
    }
    if (!improved) break;
  }
  run(); // 按最后留下的顺序排定
}

/**
 * 把大纲解析成节点和线。
 * - root：没有任何缩进线连进来的节点（起点）
 * - end：没有线连出去的节点（终点）
 * - ref：括号引用出来的线，不参与排版
 * - summary-node：`} 概要` 那一行。它是一个真节点（能接下一步、能被引用、能带备注），
 *   但不和兄弟连线，而是由一把大括号把它前面的兄弟连同各自的子树一起括起来。
 * 位置按节点文字记（key），因为解析器给的 id 是行号，插一行就会变。
 */
export function buildElements(
  source: string,
  structure: Structure = "logic",
  /** nearRefs：同级节点按引用线（虚线）的关系重新排先后，有关联的挨近，虚线变短；大纲本身的顺序不变 */
  opts: { noteLinks?: boolean; nearRefs?: boolean } = {},
): FlowElement[] {
  const noteLinks = opts.noteLinks !== false;
  // 预处理：去列表记号 → 概要行换成一个普通节点行 → 摘出【备注】→ 全角括号转义；行数不变，行号可对回节点
  const raw = source.split("\n");
  // 有 # 标题的话，先按标题把层级理顺（行数不变，行号还能对回节点）
  const lines = stripListMarkers((raw.some((l) => HEADING.test(l)) ? normalizeOutline(raw, true) : raw).join("\n")).split("\n");
  const noteByLine = new Map<number, string>();
  const summaryByLine = new Map<number, { count: number; ghost: boolean }>();
  const strongLines = new Set<number>();
  /** 每行里的网址（点节点要打开的）。备注里的不算 */
  const linksByLine = new Map<number, LinkInfo[]>();
  const warnings: FlowElement[] = [];
  const warn = (line: number, text: string) =>
    warnings.push({ group: "warnings", data: { id: "warning-" + line + "-" + warnings.length, line, text }, classes: "" });
  // 时间轴、鱼骨图、发散图的版式放不下大括号：概要当成普通节点画
  const flat = structure === "timeline" || structure === "fishbone" || structure === "radial";
  let containers = 0; // graph-selector 自己的「名字 { … }」容器开了几层
  const cleanLines = lines.map((line, i) => {
    const sum = parseSummary(line);
    if (sum) {
      if (!sum.count && !sum.text && containers > 0) {
        containers--; // 这是容器的收尾，不是概要，原样交给解析器
        return line;
      }
      // 这几种版式没地方画大括号：概要这一行先不显示（它下面要是还接了节点，会挂到前一个兄弟上）
      if (flat) return "";
      const { text, note } = extractBracketNote(sum.text);
      const body = text.trim();
      summaryByLine.set(i + 1, { count: sum.count, ghost: !body });
      if (note) noteByLine.set(i + 1, inlineMarkdown(note).text.replace(/\\(.)/g, "$1"));
      // 概要的字里有冒号是正文，不是「线上的字」——它没有连进来的线
      const md = inlineMarkdown(body, noteLinks);
      if (md.strong) strongLines.add(i + 1);
      if (body && md.links.length) linksByLine.set(i + 1, md.links);
      return sum.indent + (body ? escapeFullwidthParens(md.text.replace(/(?<!\\)([:：])/g, "\\$1")) : GHOST);
    }
    if (/(?<!\\)\{\s*$/.test(line)) containers++;
    // 先摘【备注】再转义括号：反过来的话备注文字里的全角括号会被加上反斜杠，
    // 而备注不走 parse，反斜杠会原样显示在图上的小字里（「确认\（二级\）」）。
    const { text, note } = extractBracketNote(line);
    if (note) noteByLine.set(i + 1, inlineMarkdown(note).text.replace(/\\(.)/g, "$1")); // parse 的 lineNumber 从 1 起
    const md = inlineMarkdown(text, noteLinks);
    if (md.strong) strongLines.add(i + 1);
    if (md.links.length) linksByLine.set(i + 1, md.links);
    return plainWhereObvious(escapeFullwidthParens(md.text));
  });
  if (flat && lines.some((l) => parseSummary(l))) {
    warn(0, tr("warn.flatBrace"));
  }
  // 某一行写法读不通时，不让整张图出不来：把那一行的特殊字全部当成普通字，再读一遍，并告诉用户是哪一行
  let graph: ReturnType<typeof parse>;
  const literalLines = new Set<number>();
  for (;;) {
    try {
      graph = parse(cleanLines.join("\n"));
      break;
    } catch (e: any) {
      const at = Number(e?.startLineNumber);
      if (!at || at > cleanLines.length || literalLines.has(at) || literalLines.size >= 200) throw e;
      literalLines.add(at);
      const lineText = cleanLines[at - 1];
      const indent = /^\s*/.exec(lineText)![0];
      // 行尾的 { 会被当成容器开头，补个空格就不是了
      cleanLines[at - 1] = indent + literal(lineText.slice(indent.length)) + (/\{\s*$/.test(lineText) ? " " : "");
      const shown = lines[at - 1].trim().replace(/\\(: |：)/g, "$1");
      const snippet = shown.length > 24 ? shown.slice(0, 24) + "…" : shown;
      warnings.push({
        group: "warnings",
        data: { id: "warning-" + at + "-" + warnings.length, line: at, find: shown, text: tr("warn.line", { snippet, reason: reasonOf(e?.code) }) },
        classes: "",
      });
    }
  }
  const nodeLines = new Set(graph.nodes.map((n) => n.parser?.lineNumber));
  const isRef = (e: (typeof graph.edges)[number]) => !nodeLines.has(e.parser?.lineNumber);

  // 每个节点的父节点（缩进线，非引用线；只认第一条）
  const parentOf = new Map<string, string>();
  for (const e of graph.edges) {
    if (isRef(e) || e.source === e.target) continue;
    if (!parentOf.has(e.target)) parentOf.set(e.target, e.source);
  }

  const seen: Record<string, number> = {};
  const nodes: FlowElement[] = [];
  for (const n of graph.nodes) {
    const id = String(n.data.id);
    const line = n.parser?.lineNumber ?? 0;
    const sum = summaryByLine.get(line);
    const label = sum?.ghost ? "" : String(n.data.label ?? "");
    const keyBase = sum?.ghost ? "}" : label;
    const count = (seen[keyBase] = (seen[keyBase] ?? 0) + 1);
    const key = count === 1 ? keyBase : `${keyBase} #${count}`;
    // 备注：优先用【】摘出来的；graph-selector 原生的 [note="…"] 也保留兼容
    const lineNote = noteByLine.get(line) ?? "";
    const rawNote = (n.data as Record<string, unknown>).note;
    const legacyNote = typeof rawNote === "string" || typeof rawNote === "number" ? String(rawNote).trim() : "";
    const links = linksByLine.get(line);
    nodes.push({ group: "nodes", data: { id, label, key, note: lineNote || legacyNote, line, ...(links && !sum?.ghost ? { links } : {}) }, classes: "" });
  }
  const byId = new Map<string, FlowElement>(nodes.map((n) => [n.data.id as string, n]));

  // 树：父 -> 子（按行号），根按行号
  const kids = new Map<string, FlowElement[]>();
  const roots: FlowElement[] = [];
  for (const n of nodes) {
    const p = parentOf.get(n.data.id as string);
    if (p === undefined || !byId.has(p)) {
      roots.push(n);
      continue;
    }
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p)!.push(n);
  }
  const byLine = (a: FlowElement, b: FlowElement) => (a.data.line ?? 0) - (b.data.line ?? 0);
  roots.sort(byLine);
  for (const list of kids.values()) list.sort(byLine);

  // 概要括谁：同一层里、从上一个概要之后到它之前的兄弟；`}:N` 只取其中最后 N 个。
  // 一个都括不到（写在最前面、缩进比兄弟深了一格）就不算概要，当普通节点画，并说明原因。
  const settle = (list: FlowElement[]) => {
    let run: FlowElement[] = [];
    for (const n of list) {
      const sum = summaryByLine.get(n.data.line as number);
      if (!sum) {
        run.push(n);
        continue;
      }
      const covered = sum.count > 0 ? run.slice(-sum.count) : run;
      if (covered.length === 0) {
        warn(n.data.line, tr("warn.braceNothing", { line: n.data.line as number }));
        if (sum.ghost) n.data.label = "}";
        run.push(n);
        continue;
      }
      n.classes = sum.ghost ? "summary-node ghost" : "summary-node";
      n.data.covers = covered.map((k) => k.data.id);
      run = [];
    }
  };
  settle(roots);
  for (const list of kids.values()) settle(list);

  // 线。概要节点和它的父节点之间不连线——括号已经说明了它属于哪一组。
  const edges: FlowElement[] = [];
  const edgeTo = new Map<string, FlowElement>();
  for (const e of graph.edges) {
    const ref = isRef(e);
    if (!ref && parentOf.get(e.target) === e.source && isSummary(byId.get(e.target))) continue;
    const el: FlowElement = {
      group: "edges",
      data: { id: String(e.data.id), source: e.source, target: e.target, label: String(e.data.label ?? "").replace(/\\([:：()（）{}[\]#./])/g, "$1") },
      classes: ref ? "ref" : "",
    };
    edges.push(el);
    if (!ref && parentOf.get(e.target) === e.source && !edgeTo.has(e.target)) edgeTo.set(e.target, el);
  }

  // 起点 / 终点：概要节点两样都不算
  const hasIn = new Set<string>();
  const hasOut = new Set<string>();
  for (const e of edges) {
    hasOut.add(e.data.source);
    if (e.classes !== "ref") hasIn.add(e.data.target);
  }
  for (const n of nodes) {
    if (isSummary(n)) continue;
    const id = n.data.id as string;
    n.classes = !hasIn.has(id) ? "root" : !hasOut.has(id) ? "end" : "";
  }

  const els: FlowElement[] = [...nodes, ...edges];
  const tree: Tree = { byId, kids, roots, edgeTo };
  if (structure === "radial") layoutRadial(tree, els);
  else if (structure === "fishbone") layoutFish(tree, els);
  else if (flat) layoutSpecial(els, structure);
  else {
    const refs = edges.filter((e) => e.classes === "ref");
    const run = () => layoutStack(tree, structure, refs);
    if (opts.nearRefs) pullRelated(tree, refs, run);
    else run();
  }

  // 每个节点记下连进来的那条线上写了什么、是哪种线：排版要按它给线上的字留地方
  if (structure !== "brace") {
    for (const n of nodes) {
      const e = edgeTo.get(n.data.id as string);
      n.data.inLabel = e ? (e.data.label as string) : "";
      n.data.inKind = e ? e.classes : "";
    }
  }

  // 流程图：有两个以上去向的节点是「判断」，画成菱形
  if (structure === "flow") {
    for (const n of nodes) {
      if (isSummary(n)) continue;
      if ((kids.get(n.data.id as string) ?? []).filter((k) => !isSummary(k)).length >= 2) n.classes = (n.classes + " decision").trim();
    }
  }

  // 整行加粗的节点（**某某**）图上用粗体
  for (const n of nodes) if (strongLines.has(n.data.line as number)) n.classes = (n.classes + " strong").trim();
  // 带网址的节点：图上点一下打开，字用主题的强调色
  for (const n of nodes) if (n.data.links) n.classes = (n.classes + " link").trim();

  // 括号图靠大括号分组，不用箭头连线。必须排完版再删——逻辑图靠排版给线分类。
  if (structure === "brace") {
    for (let i = els.length - 1; i >= 0; i--) {
      if (els[i].group === "edges" && els[i].classes === "") els.splice(i, 1);
    }
  }

  // 每个概要一把大括号：ids 是被括的那几个兄弟，all 还包括它们各自的整棵子树（括号要罩住的范围）
  for (const n of nodes) {
    if (!isSummary(n)) continue;
    const covers = n.data.covers as string[];
    const all: string[] = [];
    const walk = (id: string) => {
      all.push(id);
      for (const k of kids.get(id) ?? []) walk(k.data.id as string);
    };
    covers.forEach(walk);
    els.push({
      group: "summaries",
      data: { id: "summary-" + n.data.line, node: n.data.id, ids: covers, all, side: (n.data.col ?? 0) < 0 ? "left" : "right" },
      classes: "",
    });
  }
  // 括号图：每个有多个子节点的父节点自动配一把大括号，不用手写 }
  if (structure === "brace") els.push(...layoutAutoBraces(tree));
  els.push(...warnings);
  return els;
}

/**
 * 主干图 / 流程图 / 逻辑图 / 组织结构图 / 思维导图 / 括号图共用的排版：结果写回节点的 col（深度）和 row。
 *
 * 一组兄弟排在同一列、按顺序往下摞，各占自己子树那么多排。
 * - 逻辑图：父节点和第一个子节点同一排，主线是一条直线；线分成 main（主线）和 elbow（支线）。
 * - 主干图、流程图：和逻辑图一样，但正好两个子节点时，第二个放在父节点**正下方**（drop），
 *   再从那里接着往前走。主线是一条直线，支线从主线上垂直分出去，像树干和树枝。
 * - 其余三种：父节点落在自己子节点的正中间。
 * - 思维导图：根的子节点分到左右两侧，左侧用负的 col。
 *
 * 概要节点不和兄弟摞在一起：它排在「被括的那几棵子树里最深的一列」再往外一列，
 * 垂直居中。所以内层的概要自然把外层的概要推到更外面，括号不会压到线上。
 */
function layoutStack(tree: Tree, structure: Structure, refs: FlowElement[] = []): void {
  const { byId, kids, roots, edgeTo } = tree;
  const linear = structure === "logic" || structure === "trunk" || structure === "flow";
  const drops = structure === "trunk" || structure === "flow";
  const centered = !linear;
  const placed = new Set<string>();
  const order: string[] = []; // 摆放顺序，思维导图左右两侧对齐时要整体挪

  const put = (n: FlowElement, depth: number, row: number, sign: number) => {
    placed.add(n.data.id as string);
    order.push(n.data.id as string);
    n.data.col = depth === 0 ? 0 : depth * sign;
    n.data.row = row;
  };

  /** 摞一组兄弟，返回占了几排、最深到第几列、每个兄弟子树的中心排 */
  const stack = (
    list: FlowElement[],
    depth: number,
    rowStart: number,
    sign: number,
    mark: boolean,
  ): { rows: number; maxDepth: number; centers: number[] } => {
    let cursor = rowStart;
    let maxDepth = depth - 1;
    const centers: number[] = [];
    let run: { id: string; start: number; rows: number; maxDepth: number }[] = [];
    // 正好两个子节点：第二个不去下一列，落在父节点正下方
    const real = list.filter((n) => !isSummary(n) && !placed.has(n.data.id as string)).length;
    const dropSecond = drops && mark && depth >= 1 && real === 2;
    let index = 0;
    for (const n of list) {
      const id = n.data.id as string;
      if (placed.has(id)) continue;
      if (!isSummary(n)) {
        const drop = dropSecond && index === 1;
        if (mark && linear) {
          const e = edgeTo.get(id);
          if (e) e.classes = index === 0 ? "main" : drop ? "drop" : "elbow";
        }
        index++;
        const r = place(n, drop ? depth - 1 : depth, cursor, sign);
        centers.push(cursor + (r.rows - 1) / 2);
        run.push({ id, start: cursor, rows: r.rows, maxDepth: r.maxDepth });
        cursor += r.rows;
        maxDepth = Math.max(maxDepth, r.maxDepth);
        continue;
      }
      const want = new Set(n.data.covers as string[]);
      const covered = run.filter((r) => want.has(r.id));
      if (covered.length === 0) {
        // 被括的兄弟没摆出来（只会出现在有环的怪图里）：当普通节点摞下去
        const r = place(n, depth, cursor, sign);
        cursor += r.rows;
        maxDepth = Math.max(maxDepth, r.maxDepth);
        continue;
      }
      const start = covered[0].start;
      const last = covered[covered.length - 1];
      const end = last.start + last.rows; // 被括范围的下一排
      const d = Math.max(...covered.map((c) => c.maxDepth)) + 1;
      const row = start + (end - start - 1) / 2;
      put(n, d, row, sign);
      // 概要自己的下一步：从它这一排开始往外、往下排
      const sub = stack(kids.get(id) ?? [], d + 1, row, sign, true);
      // 下一步比被括的范围还高的话，把后面的兄弟往下让，免得叠在一起
      const overflow = Math.ceil(row + Math.max(1, sub.rows) - end);
      if (overflow > 0) cursor = Math.max(cursor, end + overflow);
      maxDepth = Math.max(maxDepth, d, sub.maxDepth);
      run = [];
    }
    return { rows: cursor - rowStart, maxDepth, centers };
  };

  /** 放下一个节点和它的整棵子树 */
  const place = (n: FlowElement, depth: number, rowStart: number, sign: number): { rows: number; maxDepth: number } => {
    put(n, depth, rowStart, sign);
    const sub = stack(kids.get(n.data.id as string) ?? [], depth + 1, rowStart, sign, true);
    if (centered && sub.centers.length > 0) n.data.row = (sub.centers[0] + sub.centers[sub.centers.length - 1]) / 2;
    return { rows: Math.max(1, sub.rows), maxDepth: Math.max(depth, sub.maxDepth) };
  };

  /** 思维导图：根在中间，子节点分到左右两侧。一个概要和它括的那几个兄弟必须在同一侧 */
  const placeMindmapRoot = (root: FlowElement, rowStart: number): number => {
    const list = kids.get(root.data.id as string) ?? [];
    const units: FlowElement[][] = [];
    let cur: FlowElement[] = [];
    for (const k of list) {
      if (!isSummary(k)) {
        cur.push(k);
        continue;
      }
      // 概要和它括的那几个捆成一组；`}:N` 没括到的那些各自单独算
      const covers = new Set(k.data.covers as string[]);
      for (const c of cur) if (!covers.has(c.data.id)) units.push([c]);
      units.push([...cur.filter((c) => covers.has(c.data.id)), k]);
      cur = [];
    }
    for (const k of cur) units.push([k]);
    const real = (u: FlowElement[]) => u.filter((k) => !isSummary(k)).length;
    const total = units.reduce((n, u) => n + real(u), 0);
    // 左右怎么分：顺序不变（右边从上往下、左边从下往上，读起来还是顺时针一圈），只挑在哪里切开。
    // 两个分支之间有引用线（虚线）的，尽量分在同一边：分到两边的话，虚线要横穿整张图，又长又乱。
    // 在左右节点数差不多（多的一边不超过总数的 65%）的切法里，挑横穿的虚线最少的；一样少就挑最平均的。
    const unitOf = new Map<string, number>();
    units.forEach((u, i) => {
      const stackIds = u.map((k) => k.data.id as string);
      while (stackIds.length) {
        const id = stackIds.pop()!;
        if (unitOf.has(id)) continue;
        unitOf.set(id, i);
        for (const k of kids.get(id) ?? []) stackIds.push(k.data.id as string);
      }
    });
    const links: [number, number][] = [];
    for (const e of refs) {
      const a = unitOf.get(e.data.source as string);
      const b = unitOf.get(e.data.target as string);
      if (a !== undefined && b !== undefined && a !== b) links.push([a, b]);
    }
    let cut = 0;
    {
      let acc = 0;
      for (const u of units) {
        if (acc >= total / 2) break;
        acc += real(u);
        cut++;
      }
    }
    if (links.length && units.length > 1) {
      let best = { cut, cross: Infinity, diff: Infinity };
      let acc = 0;
      for (let k = 1; k < units.length; k++) {
        acc += real(units[k - 1]);
        if (Math.max(acc, total - acc) > total * 0.65 && total > 2) continue;
        const cross = links.filter(([a, b]) => a < k !== b < k).length;
        const diff = Math.abs(total - 2 * acc);
        if (cross < best.cross || (cross === best.cross && diff < best.diff)) best = { cut: k, cross, diff };
      }
      if (best.cross !== Infinity) cut = best.cut;
    }
    const right: FlowElement[] = units.slice(0, cut).flat();
    const left: FlowElement[] = units.slice(cut).flat();
    put(root, 0, rowStart, 1);
    const side = (items: FlowElement[], sign: number) => {
      const from = order.length;
      const res = stack(items, 1, rowStart, sign, true);
      return { rows: res.rows, ids: order.slice(from) };
    };
    const r = side(right, 1);
    const l = side(left, -1);
    const span = Math.max(r.rows, l.rows, 1);
    for (const s of [r, l]) {
      const shift = (span - s.rows) / 2;
      if (shift > 0) for (const id of s.ids) byId.get(id)!.data.row += shift;
    }
    root.data.row = rowStart + (span - 1) / 2;
    return span;
  };

  // 根这一层也是一组兄弟（也可以被概要括起来）；只有思维导图的根要单独处理
  let row = 0;
  if (structure === "mindmap") {
    for (const r of roots) {
      if (placed.has(r.data.id as string)) continue;
      const many = (kids.get(r.data.id as string) ?? []).filter((k) => !isSummary(k)).length > 1;
      row += many && !isSummary(r) ? placeMindmapRoot(r, row) : place(r, 0, row, 1).rows;
    }
  } else {
    row += stack(roots, 0, 0, 1, false).rows;
  }
  // 兜底：环或者引用漏掉的节点
  for (const n of byId.values()) if (!placed.has(n.data.id as string)) row += place(n, 0, row, 1).rows;
}

/**
 * 发散图：中心节点在正中，子节点朝四周均匀散开，一层一圈往外长。
 * 每个节点分到一段角度（按它底下的叶子数分），自己站在这段角度的正中间。
 * 结果写在 data.polar 里：depth 第几圈、angle 朝哪（弧度，0 朝右、顺时针）、span 这一段有多宽。
 * 具体半径由 pack.ts 按节点尺寸算。
 */
function layoutRadial(tree: Tree, els: FlowElement[]): void {
  const { kids, roots } = tree;
  const seen = new Set<string>();
  const leaves = new Map<string, number>();
  const count = (n: FlowElement): number => {
    const id = n.data.id as string;
    if (leaves.has(id)) return leaves.get(id)!;
    leaves.set(id, 1); // 先占位，防环
    const list = kids.get(id) ?? [];
    const total = list.length === 0 ? 1 : list.reduce((sum, k) => sum + count(k), 0);
    leaves.set(id, total);
    return total;
  };
  const spread = (list: FlowElement[], depth: number, from: number, span: number) => {
    const total = list.reduce((sum, k) => sum + count(k), 0) || 1;
    let at = from;
    for (const n of list) {
      const id = n.data.id as string;
      const part = (span * count(n)) / total;
      if (!seen.has(id)) {
        seen.add(id);
        n.data.polar = { depth, angle: at + part / 2, span: part };
        n.data.col = depth;
        n.data.row = 0;
        spread(kids.get(id) ?? [], depth + 1, at, part);
      }
      at += part;
    }
  };
  const TOP = -Math.PI / 2; // 从正上方开始，顺时针排
  if (roots.length === 1) {
    const root = roots[0];
    seen.add(root.data.id as string);
    root.data.polar = { depth: 0, angle: 0, span: Math.PI * 2 };
    root.data.col = 0;
    root.data.row = 0;
    spread(kids.get(root.data.id as string) ?? [], 1, TOP, Math.PI * 2);
  } else {
    // 有好几个起点：没有谁是中心，都站到第一圈上
    spread(roots, 1, TOP, Math.PI * 2);
  }
  for (const e of els) if (e.group === "edges" && e.classes === "") e.classes = "ray";
}

/** 把父 -> 子（按行号排序）整理出来，供时间轴 / 鱼骨图用 */
function kidsOf(els: FlowElement[]): { kids: Map<string, FlowElement[]>; byId: Map<string, FlowElement>; roots: string[] } {
  const nodes = els.filter((e) => e.group === "nodes");
  const byId = new Map<string, FlowElement>();
  for (const n of nodes) byId.set(n.data.id as string, n);
  const kids = new Map<string, FlowElement[]>();
  const hasParent = new Set<string>();
  for (const e of els) {
    if (e.group !== "edges" || e.classes.split(" ").includes("ref")) continue;
    const t = e.data.target as string;
    const s = e.data.source as string;
    if (hasParent.has(t)) continue; // 只认第一条缩进线当父
    hasParent.add(t);
    const child = byId.get(t);
    if (!child) continue;
    if (!kids.has(s)) kids.set(s, []);
    kids.get(s)!.push(child);
  }
  for (const list of kids.values()) {
    list.sort((a, b) => (a.data.line ?? 0) - (b.data.line ?? 0));
  }
  const roots = nodes.map((n) => n.data.id as string).filter((id) => !hasParent.has(id));
  return { kids, byId, roots };
}

/**
 * 鱼骨图：一根横着的主干，头（根节点）在最右边；第一层子节点是「骨」，一上一下交替斜着长出去；
 * 每根骨底下的所有节点按大纲顺序一行一个，挂在这根斜骨上，越深缩进越多。
 * 这里只记每个节点在鱼身上的角色（data.fish），具体坐标要等量出节点尺寸后由 fish.ts 算。
 */
function layoutFish(tree: Tree, els: FlowElement[]): void {
  const { kids, roots, byId } = tree;
  const placed = new Set<string>();
  const real = (list: FlowElement[]) => list.filter((n) => !isSummary(n) && !placed.has(n.data.id as string));
  roots.forEach((head, fish) => {
    if (placed.has(head.data.id as string)) return;
    placed.add(head.data.id as string);
    head.data.fish = { role: "head", fish };
    real(kids.get(head.data.id as string) ?? []).forEach((bone, i) => {
      placed.add(bone.data.id as string);
      const side = i % 2 === 0 ? -1 : 1; // 第一根朝上
      bone.data.fish = { role: "bone", fish, bone: i, side };
      let row = 0;
      const walk = (n: FlowElement, depth: number) => {
        for (const k of real(kids.get(n.data.id as string) ?? [])) {
          placed.add(k.data.id as string);
          k.data.fish = { role: "row", fish, bone: i, side, row: row++, depth };
          walk(k, depth + 1);
        }
      };
      walk(bone, 1);
    });
  });
  // 兜底：环或者引用漏掉的节点，排在最下面一行
  let extra = 0;
  for (const n of byId.values()) if (!placed.has(n.data.id as string)) n.data.fish = { role: "loose", fish: roots.length, row: extra++ };

  for (const e of els) {
    if (e.group !== "edges" || e.classes === "ref") continue;
    const t = byId.get(e.data.target as string)?.data.fish;
    e.classes = !t ? "" : t.role === "bone" ? "spine" : t.role === "row" && t.depth === 1 ? "rib" : "twig";
  }
}

/**
 * 时间轴：第一层子节点沿主线一根排开，各自的后续层级从上往下叠成一列。
 * 排完给线分类（spine 主干 / mark 挂线），样式按类画，见 themes.ts。
 */
function layoutSpecial(els: FlowElement[], structure: Structure): void {
  const { kids, byId, roots } = kidsOf(els);
  const placed = new Set<string>();
  const ids = [...byId.keys()];

  /**
   * 挂在某个节点下面的后来者：从上往下一格一个，返回整棵子树占了几格。
   * 同一父节点的子节点必须各占一格——都塞在 (col+1, row) 会完全重叠，图上只剩最后一个。
   */
  const hang = (id: string, col: number, row: number): number => {
    const node = byId.get(id);
    if (!node || placed.has(id)) return 0;
    placed.add(id);
    node.data.col = col;
    node.data.row = row;
    let cursor = col + 1;
    for (const c of kids.get(id) ?? []) {
      const used = hang(c.data.id as string, cursor, row);
      if (used === 0) continue;
      cursor += used;
    }
    return cursor - col;
  };

  let row = 0;
  for (const r of roots) {
    const node = byId.get(r);
    if (!node) continue;
    if (placed.has(r)) continue;
    placed.add(r);
    node.data.col = 0;
    node.data.row = row;
    const bones = (kids.get(r) ?? []).map((c) => c.data.id as string);
    let spineRow = row + 1;
    for (const bone of bones) {
      const b = byId.get(bone);
      if (!b || placed.has(bone)) continue;
      placed.add(bone);
      b.data.col = 0;
      b.data.row = spineRow;
      let k = 0;
      for (const c of kids.get(bone) ?? []) {
        k += hang(c.data.id as string, 1 + k, spineRow);
      }
      spineRow += 1;
    }
    row = spineRow + 1;
  }
  // 兜底：环或者引用漏掉的节点
  for (const id of ids) if (!placed.has(id)) hang(id, 0, row++);

  // 线分类：两头都在主轴上的是主干，别的是挂线 / 骨刺
  for (const e of els) {
    if (e.group !== "edges" || e.classes === "ref") continue;
    const s = byId.get(e.data.source as string);
    const t = byId.get(e.data.target as string);
    if (!s || !t) continue;
    const onSpine = (s.data.col ?? 0) === 0 && (t.data.col ?? 0) === 0;
    e.classes = onSpine ? "spine" : "mark";
  }
}

/**
 * 括号图：给每个有 2 个以上子节点的父节点配一把大括号。
 * 类名给成 brace，和手写的 `} 概要` 区分开——
 * 概要的尖朝外（它在被括的节点之后），括号图的尖朝父节点（它夹在父节点和子节点中间）。
 */
function layoutAutoBraces(tree: Tree): FlowElement[] {
  const out: FlowElement[] = [];
  for (const [pid, all] of tree.kids) {
    const list = all.filter((n) => !isSummary(n));
    if (list.length < 2) continue;
    out.push({
      group: "summaries",
      data: { id: "brace-" + pid, ids: list.map((n) => n.data.id), all: list.map((n) => n.data.id), side: (list[0].data.col ?? 0) < 0 ? "left" : "right" },
      classes: "brace",
    });
  }
  return out;
}

export const BLOCK_LANG = "flow";
const FENCE_OPEN = new RegExp("^\\s*(`{3,}|~{3,})\\s*" + BLOCK_LANG + "\\s*$");

export interface FlowBlock {
  index: number;
  source: string;
  /** 开头和结尾围栏所在的行号（从 0 数） */
  start: number;
  end: number;
}

/** 找出一篇笔记里所有的 flow 代码块，顺序和笔记里图的顺序一致 */
export function findFlowBlocks(text: string): FlowBlock[] {
  const lines = text.split("\n");
  const blocks: FlowBlock[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = FENCE_OPEN.exec(lines[i]);
    if (!m) continue;
    const mark = m[1];
    const close = new RegExp("^\\s*" + mark[0] + "{" + mark.length + ",}\\s*$");
    let j = i + 1;
    while (j < lines.length && !close.test(lines[j])) j++;
    blocks.push({ index: blocks.length, source: lines.slice(i + 1, j).join("\n"), start: i, end: Math.min(j, lines.length - 1) });
    i = j;
  }
  return blocks;
}
