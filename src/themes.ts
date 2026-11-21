// 流程图的主题与线型。每套主题只是一组取值，换主题不动结构和位置。
// 这里是图内配色的唯一来源；插件自身的界面（工具条、设置）用 Obsidian 的变量，见 styles.css。

import { t } from "./i18n";
import type { Key } from "./i18n";
import { labelSize } from "./pack";
import { wrapCached } from "./wrap";

export type Direction = "LR" | "TB";

/** 结构：同一份大纲可以按不同版式摆。主干图、流程图、逻辑图听「方向」设置，别的轴是定死的。 */
export type Structure = "trunk" | "flow" | "logic" | "org" | "mindmap" | "radial" | "brace" | "timeline" | "fishbone";

export interface Theme {
  /** 画布的 CSS 背景 */
  stage: string;
  /** 画布底色，用来垫在线上文字的后面 */
  canvas: string;
  node: {
    bg: string;
    border: string;
    borderWidth: number;
    text: string;
    shape: string;
    /** 两色渐变；给了就盖掉 bg，节点有立体感 */
    grad?: [string, string];
    /** 阴影颜色；给了就加一层柔光 */
    shadow?: string;
  };
  root: { bg: string; border: string; text: string; grad?: [string, string] };
  end: { bg: string; border: string; text: string; grad?: [string, string] };
  /** round：折线的拐角和节点一样是圆的 */
  edge: { color: string; width: number; round: boolean; label: string };
  /**
   * 分支配色：每个一级分支轮流用 palette 里的一种颜色，它下面的节点和线都跟着这个颜色。
   * level1：一级分支是实色填满（fill），还是浅色底加彩色边（tint）。没有这一项就是整张图一种颜色。
   */
  branches?: { palette: string[]; level1: "fill" | "tint" };
}

/** 点阵画布：底色上一层小圆点 */
const dots = (dot: string, bg: string) => `radial-gradient(${dot} 1px, transparent 1px) 0 0 / 20px 20px, ${bg}`;

export const THEMES: Record<string, Theme> = {
  card: {
    stage: "radial-gradient(#d5d9e2 1px, transparent 1px) 0 0 / 20px 20px, #f4f5f7",
    canvas: "#f4f5f7",
    node: { bg: "#ffffff", border: "#d9dde5", borderWidth: 1, text: "#1d2129", shape: "round-rectangle", shadow: "#0b122014" },
    root: { bg: "#2f6bff", border: "#2f6bff", text: "#ffffff" },
    end: { bg: "#ffffff", border: "#2f6bff", text: "#1d2129" },
    edge: { color: "#9aa3b2", width: 1.5, round: true, label: "#4b5563" },
  },
  dark: {
    stage: "radial-gradient(#2a2f3a 1px, transparent 1px) 0 0 / 20px 20px, #14171c",
    canvas: "#14171c",
    node: { bg: "#20252e", border: "#343b48", borderWidth: 1, text: "#e6e9ef", shape: "round-rectangle" },
    root: { bg: "#5b8cff", border: "#5b8cff", text: "#0c1020" },
    end: { bg: "#20252e", border: "#5b8cff", text: "#e6e9ef" },
    edge: { color: "#5c6676", width: 1.5, round: true, label: "#aab3c2" },
  },
  aurora: {
    stage: "radial-gradient(#1b2133 1px, transparent 1px) 0 0 / 20px 20px, #0b0f19",
    canvas: "#0b0f19",
    node: {
      bg: "#1b2438",
      border: "#33436b",
      borderWidth: 1,
      text: "#dde5f5",
      shape: "round-rectangle",
      grad: ["#1e2a44", "#27354f"],
    },
    root: { bg: "#6d5cff", border: "#8f82ff", text: "#ffffff", grad: ["#7c5cff", "#5b8cff"] },
    end: { bg: "#12233a", border: "#22d3ee", text: "#c8f4ff" },
    edge: { color: "#3b5578", width: 1.6, round: true, label: "#8fa6c4" },
  },
  neon: {
    stage: "radial-gradient(#1d1630 1px, transparent 1px) 0 0 / 20px 20px, #08060f",
    canvas: "#08060f",
    node: {
      bg: "#171129",
      border: "#3b2a6b",
      borderWidth: 1.2,
      text: "#ece7ff",
      shape: "round-rectangle",
      grad: ["#1a1230", "#241a42"],
      shadow: "#ff2d9540",
    },
    root: { bg: "#ff2d95", border: "#ff7ac0", text: "#ffffff", grad: ["#ff2d95", "#7b2dff"] },
    end: { bg: "#0d2230", border: "#00e5ff", text: "#b6f7ff" },
    edge: { color: "#5a3f96", width: 1.8, round: true, label: "#b9a6ff" },
  },
  mint: {
    stage: "radial-gradient(#cfe4d8 1px, transparent 1px) 0 0 / 20px 20px, #f2f8f4",
    canvas: "#f2f8f4",
    node: { bg: "#ffffff", border: "#cbe4d6", borderWidth: 1, text: "#1e3a2c", shape: "round-rectangle", shadow: "#0e3b2a12" },
    root: { bg: "#2f9e73", border: "#2f9e73", text: "#ffffff", grad: ["#3cb489", "#248a63"] },
    end: { bg: "#ffffff", border: "#2f9e73", text: "#1e3a2c" },
    edge: { color: "#93bda9", width: 1.5, round: true, label: "#48705c" },
  },
  sunset: {
    stage: "radial-gradient(#f6d9c4 1px, transparent 1px) 0 0 / 20px 20px, #fff8f1",
    canvas: "#fff8f1",
    node: {
      bg: "#fffdfb",
      border: "#f7d2b6",
      borderWidth: 1,
      text: "#3a2318",
      shape: "round-rectangle",
      grad: ["#ffffff", "#fff0e2"],
      shadow: "#c2410c18",
    },
    root: { bg: "#ff8a4c", border: "#ff8a4c", text: "#ffffff", grad: ["#ffa14c", "#ff5f6d"] },
    end: { bg: "#fffdfb", border: "#ff7a59", text: "#3a2318" },
    edge: { color: "#dda88c", width: 1.6, round: true, label: "#8a5540" },
  },
  paper: {
    stage: "radial-gradient(#dfd6bd 1px, transparent 1px) 0 0 / 20px 20px, #f8f4e9",
    canvas: "#f8f4e9",
    node: { bg: "#fffdf6", border: "#cbbd9a", borderWidth: 1, text: "#332c1f", shape: "rectangle" },
    root: { bg: "#33301f", border: "#33301f", text: "#f8f4e9" },
    end: { bg: "#fffdf6", border: "#33301f", text: "#332c1f" },
    edge: { color: "#9c9077", width: 1.4, round: false, label: "#6b6047" },
  },
  mono: {
    stage: "#ffffff",
    canvas: "#ffffff",
    node: { bg: "#ffffff", border: "#1a1a1a", borderWidth: 1.4, text: "#111111", shape: "rectangle" },
    root: { bg: "#111111", border: "#111111", text: "#ffffff" },
    end: { bg: "#ffffff", border: "#111111", text: "#111111" },
    edge: { color: "#1a1a1a", width: 1.4, round: false, label: "#333333" },
  },
  yellow: {
    stage: "#e9e9e6",
    canvas: "#e9e9e6",
    node: { bg: "#ffffff", border: "#ffffff", borderWidth: 0, text: "#111111", shape: "round-rectangle" },
    root: { bg: "#ffc93c", border: "#ffc93c", text: "#111111" },
    end: { bg: "#111111", border: "#111111", text: "#ffffff" },
    edge: { color: "#111111", width: 1.5, round: true, label: "#111111" },
  },
};

/**
 * 带分支配色的一组主题。配色思路：
 * - 每套 6 个分支色，色相拉开、明度和饱和度接近，放在一起不会有哪个特别跳；
 * - 中心主题用最深（或深色主题里最亮）的中性色，不跟任何分支抢；
 * - 一级分支最醒目，往外一层比一层淡、线一层比一层细，层次靠颜色深浅和线的粗细拉开，不靠加框加阴影。
 */
const BRANCH_THEMES: Record<string, Theme> = {
  colorful: {
    stage: dots("#eceef2", "#ffffff"),
    canvas: "#ffffff",
    node: { bg: "#ffffff", border: "#e3e6eb", borderWidth: 1, text: "#1f2329", shape: "round-rectangle" },
    root: { bg: "#1f2329", border: "#1f2329", text: "#ffffff" },
    end: { bg: "#ffffff", border: "#1f2329", text: "#1f2329" },
    edge: { color: "#b8bec8", width: 1.6, round: true, label: "#5b6270" },
    branches: { palette: ["#ef5f5b", "#f39c32", "#2eae76", "#2f8cf0", "#7a63f0", "#e2559a"], level1: "fill" },
  },
  morandi: {
    stage: dots("#e6e0d6", "#f5f2ed"),
    canvas: "#f5f2ed",
    node: { bg: "#fbf9f6", border: "#e2dbcf", borderWidth: 1, text: "#3d3833", shape: "round-rectangle" },
    root: { bg: "#4a443e", border: "#4a443e", text: "#f7f3ee" },
    end: { bg: "#fbf9f6", border: "#4a443e", text: "#3d3833" },
    edge: { color: "#c7bfb2", width: 1.6, round: true, label: "#6f675d" },
    branches: { palette: ["#b8736a", "#c39a57", "#87a07f", "#6d93a6", "#9587a8", "#a98a7c"], level1: "fill" },
  },
  fog: {
    stage: dots("#e2e8ef", "#f5f7fa"),
    canvas: "#f5f7fa",
    node: { bg: "#ffffff", border: "#dce3ec", borderWidth: 1, text: "#1e2733", shape: "round-rectangle" },
    root: { bg: "#2f5bea", border: "#2f5bea", text: "#ffffff" },
    end: { bg: "#ffffff", border: "#2f5bea", text: "#1e2733" },
    edge: { color: "#b3bfce", width: 1.6, round: true, label: "#5a6778" },
    branches: { palette: ["#2f5bea", "#22958a", "#6c5ce7", "#de7a3e", "#c4497b", "#3b8a58"], level1: "tint" },
  },
  plain: {
    stage: "#ffffff",
    canvas: "#ffffff",
    node: { bg: "#ffffff", border: "#e4e4e7", borderWidth: 1, text: "#18181b", shape: "round-rectangle" },
    root: { bg: "#18181b", border: "#18181b", text: "#ffffff" },
    end: { bg: "#ffffff", border: "#18181b", text: "#18181b" },
    edge: { color: "#c4c4ca", width: 1.5, round: true, label: "#52525b" },
    branches: { palette: ["#3f3f46"], level1: "tint" },
  },
  inkpaper: {
    stage: dots("#e3d9c6", "#f3ede2"),
    canvas: "#f3ede2",
    node: { bg: "#fbf8f2", border: "#d9cdb8", borderWidth: 1, text: "#2b2722", shape: "round-rectangle" },
    root: { bg: "#2b2722", border: "#2b2722", text: "#f3ede2" },
    end: { bg: "#fbf8f2", border: "#2b2722", text: "#2b2722" },
    edge: { color: "#b9ad98", width: 1.6, round: true, label: "#6f6658" },
    // 朱砂、靛青、松绿、赭石、黛紫、墨灰
    branches: { palette: ["#b5443a", "#2f5d8c", "#4e7d5b", "#a8742f", "#6a5687", "#5b5852"], level1: "tint" },
  },
  night: {
    stage: dots("#1f242c", "#12151a"),
    canvas: "#12151a",
    node: { bg: "#1a1f27", border: "#2a313c", borderWidth: 1, text: "#e6eaf0", shape: "round-rectangle" },
    root: { bg: "#e6eaf0", border: "#e6eaf0", text: "#12151a" },
    end: { bg: "#1a1f27", border: "#e6eaf0", text: "#e6eaf0" },
    edge: { color: "#3a4250", width: 1.6, round: true, label: "#9aa4b2" },
    branches: { palette: ["#ff7b72", "#ffb454", "#4fd1a5", "#5cb8ff", "#a58cff", "#f48fc4"], level1: "tint" },
  },
  pine: {
    stage: dots("#1a2520", "#0f1714"),
    canvas: "#0f1714",
    node: { bg: "#16211c", border: "#24342c", borderWidth: 1, text: "#dce7e1", shape: "round-rectangle" },
    root: { bg: "#3fb68b", border: "#3fb68b", text: "#08120e" },
    end: { bg: "#16211c", border: "#3fb68b", text: "#dce7e1" },
    edge: { color: "#2c3f36", width: 1.6, round: true, label: "#8fa79b" },
    branches: { palette: ["#3fb68b", "#e3b25a", "#5fa8d3", "#e08a6e", "#a693e0", "#7fc8b4"], level1: "fill" },
  },
  print: {
    stage: "#ffffff",
    canvas: "#ffffff",
    node: { bg: "#ffffff", border: "#111111", borderWidth: 1.2, text: "#111111", shape: "round-rectangle" },
    root: { bg: "#111111", border: "#111111", text: "#ffffff" },
    end: { bg: "#ffffff", border: "#111111", text: "#111111" },
    edge: { color: "#111111", width: 1.4, round: true, label: "#333333" },
    branches: { palette: ["#111111"], level1: "tint" },
  },
};
const SINGLE_KEYS = Object.keys(THEMES);
Object.assign(THEMES, BRANCH_THEMES);

/** 主题的名字：跟着当前语言走，显示时才取（不存在的 key 原样返回） */
export function themeName(key: string): string {
  return key in THEMES ? t(`theme.${key}` as Key) : key;
}

/** 主题菜单分两组：每个分支各一种颜色的、整张一种颜色的。色块取几种代表色 */
export function themeGroups(): { title: string; items: { value: string; label: string; swatch: string[] }[] }[] {
  const item = (k: string) => {
    const th = THEMES[k];
    const swatch = th.branches ? [th.root.bg, ...th.branches.palette].slice(0, 5) : [th.root.grad?.[0] ?? th.root.bg, th.node.border, th.edge.color];
    return { value: k, label: themeName(k), swatch };
  };
  return [
    { title: t("themeGroup.branch"), items: Object.keys(BRANCH_THEMES).map(item) },
    { title: t("themeGroup.single"), items: SINGLE_KEYS.map(item) },
  ];
}

export const DEFAULT_THEME = "card";

/** 把 #rrggbb 读成 0 到 255 的三个数；别的写法返回 null */
function rgb(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** 颜色的相对亮度，0 最暗、1 最亮（WCAG 的算法，用来算对比度） */
function luminance(hex: string): number | null {
  const c = rgb(hex);
  if (!c) return null;
  const [r, g, b] = c.map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** 两个颜色的对比度，1 到 21。读不出颜色时按「够用」算，不去动它 */
function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  if (la === null || lb === null) return 21;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** 这套主题是不是深色：看画布底色的感知亮度 */
export function isDarkTheme(themeKey: string): boolean {
  const c = rgb((THEMES[themeKey] ?? THEMES[DEFAULT_THEME]).canvas);
  if (!c) return false;
  return (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255 < 0.5;
}

/**
 * 导出的网页跟着看的人的系统走深浅色：这套主题的深浅和系统一致就照用，
 * 不一致就换成「浅色卡片」或「深色」。
 */
export function themeForMode(themeKey: string, dark: boolean): string {
  const key = THEMES[themeKey] ? themeKey : DEFAULT_THEME;
  if (isDarkTheme(key) === dark) return key;
  return dark ? "dark" : "card";
}

/** 方向的名字（跟着当前语言走） */
export function directionName(d: Direction): string {
  return t(`direction.${d}` as Key);
}

/** 菜单里能选的结构，按菜单里的顺序。每种的方向、线型都定死、调好，不再单独选 */
export const STRUCTURES: readonly Structure[] = ["mindmap", "logic", "org", "radial"];

/** 结构的名字，包括归档的（菜单里不显示，旧数据里可能还存着）。跟着当前语言走，显示时才取 */
export function structureName(s: Structure): string {
  return t(`structure.${s}` as Key);
}

/** 菜单、设置里的结构选项：值和当前语言的名字 */
export function structureOptions(): { value: Structure; label: string }[] {
  return STRUCTURES.map((value) => ({ value, label: structureName(value) }));
}

export const DEFAULT_STRUCTURE: Structure = "mindmap";

/**
 * 实际用哪种结构画。主干图并进了思维导图；流程图、括号图、时间轴、鱼骨图归档了（代码还在，菜单里不给选），
 * 以前存成这些的图按思维导图画，存着的设置不去改它，哪天放出来还能接着用。
 */
export function liveStructure(s: string | undefined | null): Structure {
  return s && (STRUCTURES as readonly string[]).includes(s) ? (s as Structure) : DEFAULT_STRUCTURE;
}

/** 每种结构固定用的线：思维导图用弧线，放射图用直线，逻辑图、组织结构图用圆角折线 */
export function lineFor(structure: Structure): LineMode {
  // 放射图的线朝四面八方，弯线在里面绕来绕去很乱，直线最清楚
  return structure === "mindmap" ? "curve" : structure === "radial" ? "straight" : "poly";
}

/** 这种结构听不听「方向」设置 */
export function followsDirection(structure: Structure): boolean {
  // 方向也不再单独选：逻辑图固定往右，组织结构图固定往下。归档的主干图、流程图还按存着的方向
  return structure === "trunk" || structure === "flow";
}

/**
 * 每种结构用哪个轴当「深度」轴。
 * 逻辑图听用户的「方向」；组织结构图 / 时间轴 / 鱼骨图固定向下；
 * 思维导图 / 括号图固定向右（思维导图的左半边用负的 col 表示）。
 */
export function axisFor(structure: Structure, dir: Direction): Direction {
  if (followsDirection(structure)) return dir;
  return structure === "org" || structure === "timeline" ? "TB" : "LR";
}

/** 线型：折线横平竖直；直线就是直的；弧线是真正弯的贝塞尔 */
export type LineMode = "poly" | "straight" | "curve";
/** 线型的名字（跟着当前语言走） */
export function lineModeName(m: LineMode): string {
  return t(`line.${m}` as Key);
}

/** 拖完节点吸附用的小格子。附近有别的节点时优先和它对齐，见主程序的 snapPoint */
export const GRID = 20;

/** 这条线在图中心的哪一侧：引用线都往外侧绕，免得压在中间的节点上 */
function outerSide(edge: any): number {
  const a = edge.source().position();
  const b = edge.target().position();
  const box = edge.cy().nodes().boundingBox();
  const cx = (box.x1 + box.x2) / 2;
  const cy = (box.y1 + box.y2) / 2;
  const side = Math.sign((b.x - a.x) * (cy - a.y) - (b.y - a.y) * (cx - a.x)) || 1;
  return -side;
}

/** 弧线模式下引用线鼓出去多少：越长鼓得越多 */
function bow(edge: any): number {
  const a = edge.source().position();
  const b = edge.target().position();
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  // 鼓得太多，虚线会在图外面兜一个大圈，看着比实际的关系远得多；轻轻鼓一点，能和实线分开就够
  return outerSide(edge) * Math.min(160, Math.max(36, len * 0.18));
}

/** 渐变节点的样式片段；没配渐变就是空对象 */
function gradOf(c: { grad?: [string, string] }): Record<string, string> {
  if (!c.grad) return {};
  return {
    "background-fill": "linear-gradient",
    "background-gradient-stop-colors": `${c.grad[0]} ${c.grad[1]}`,
    "background-gradient-direction": "to-bottom-right",
  };
}

function shadowOf(c: { shadow?: string }): Record<string, string | number> {
  if (!c.shadow) return {};
  return { "shadow-blur": 16, "shadow-offset-y": 3, "shadow-opacity": 0.6, "shadow-color": c.shadow };
}

/**
 * 带网址的节点，字用主题的强调色（起点节点的底色）。
 * 起点节点自己就是强调色的底，字不能再用强调色；终点节点按自己的底色判断。
 * 强调色和节点底色对比不够（黄色重点主题：黄字落在白底上看不清）就不改字色。
 * 必须排在 node.root / node.end 之后：同一属性后者覆盖前者。
 */
function linkRules(t: Theme): any[] {
  const accent = t.root.grad?.[0] ?? t.root.bg;
  const rules: any[] = [];
  const add = (selector: string, fill: string, own: string) => {
    if (contrast(accent, fill) >= 3) rules.push({ selector, style: { color: accent } });
    else rules.push({ selector, style: { color: own } });
  };
  add("node.link", t.node.grad?.[0] ?? t.node.bg, t.node.text);
  add("node.link.end", t.end.grad?.[0] ?? t.end.bg, t.end.text);
  add("node.link.root", t.root.grad?.[0] ?? t.root.bg, t.root.text);
  // 概要节点沿用普通节点的底色
  rules.push({ selector: "node.link.summary-node", style: { color: rules[0].style.color } });
  return rules;
}

/**
 * 选中的节点：描一圈强调色的边，外面再垫一圈淡淡的光（起点节点自己就是强调色的底，光晕保证它也看得出来）。
 * editing：正在图上改字，节点里的字交给盖在上面的输入框画，这里不画；temp：还没写进笔记的新节点，虚线框。
 * 要排在 node.root / node.end / node.link 之后：同一属性后者覆盖前者。
 */
function selectRules(t: Theme): any[] {
  const accent = t.root.grad?.[0] ?? t.root.bg;
  return [
    {
      // 选中：外面描一圈强调色的轮廓线，跟着节点自己的圆角走。
      // 以前用的是底下垫一块半透明的光晕，光晕的圆角和节点对不上，看着像节点变了形
      selector: "node.selected",
      style: {
        "outline-width": 2,
        "outline-color": accent,
        "outline-opacity": 1,
        "outline-offset": 3,
        "outline-style": "solid",
      },
    },
    { selector: "node.temp, node.fresh", style: { "border-style": "dashed", "border-width": 1.5, "border-color": accent } },
    { selector: "node.editing", style: { "text-opacity": 0 } },
  ];
}

/** 两个颜色按比例混：k=1 全是 a，k=0 全是 b */
function mix(a: string, b: string, k: number): string {
  const x = rgb(a);
  const y = rgb(b);
  if (!x || !y) return a;
  const c = x.map((v, i) => Math.round(v * k + y[i] * (1 - k)));
  return "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
}

/** 落在这个底色上的字用白还是用深色：白字对比度够就用白 */
function textOn(bg: string, dark: string): string {
  return contrast(bg, "#ffffff") >= 3 ? "#ffffff" : dark;
}

/**
 * 分支配色的样式（节点和线上要有 data.br：第几个一级分支，data.dep：第几层，中心是 0；见 branch.ts）。
 * 一级分支最醒目，往外一层比一层淡；线跟着分支的颜色，一层比一层细；树上的线不带箭头（思维导图的习惯），
 * 引用线（回指的虚线）还是带箭头，用中性色，免得和分支混在一起。
 * 要排在 node.root / node.end 之后、node.link 和选中样式之前。
 */
function branchRules(t: Theme): any[] {
  const b = t.branches;
  if (!b) return [];
  const dark = isDarkCanvas(t.canvas);
  const color = (ele: any) => b.palette[((ele.data("br") ?? 0) % b.palette.length + b.palette.length) % b.palette.length];
  const deep = (ele: any) => Math.max(1, Number(ele.data("dep") ?? 1));
  // 往外每一层，颜色向底色淡一点
  const fade = (ele: any, k1: number, step: number, min: number) => mix(color(ele), t.canvas, Math.max(min, k1 - step * (deep(ele) - 1)));
  return [
    {
      selector: "node[dep >= 2]",
      style: {
        "background-color": (e: any) => mix(color(e), t.canvas, dark ? 0.12 : 0.07),
        "background-fill": "solid",
        "border-color": (e: any) => fade(e, 0.55, 0.12, 0.25),
        "border-width": 1,
        color: t.node.text,
        "shadow-blur": 0,
      },
    },
    b.level1 === "fill"
      ? {
          selector: "node[dep = 1]",
          style: {
            "background-color": color,
            "background-fill": "solid",
            "border-color": color,
            "border-width": 0,
            color: (e: any) => textOn(color(e), t.node.text),
            "font-weight": 600,
            "shadow-blur": 0,
          },
        }
      : {
          selector: "node[dep = 1]",
          style: {
            "background-color": (e: any) => mix(color(e), t.canvas, dark ? 0.2 : 0.12),
            "background-fill": "solid",
            "border-color": color,
            "border-width": 1.5,
            color: t.node.text,
            "font-weight": 600,
            "shadow-blur": 0,
          },
        },
    { selector: "node.root", style: { "font-size": 16, "font-weight": 700, padding: 16, "shadow-blur": 0 } },
  ];
}

/** 分支配色里线的部分：要排在通用的 edge 规则和各结构的线型之后，不然颜色会被盖回去 */
function branchEdgeRules(t: Theme): any[] {
  const b = t.branches;
  if (!b) return [];
  const color = (ele: any) => b.palette[((ele.data("br") ?? 0) % b.palette.length + b.palette.length) % b.palette.length];
  const deep = (ele: any) => Math.max(1, Number(ele.data("dep") ?? 1));
  const fade = (ele: any, k1: number, step: number, min: number) => mix(color(ele), t.canvas, Math.max(min, k1 - step * (deep(ele) - 1)));
  return [
    {
      selector: "edge[dep >= 1]",
      style: {
        "line-color": (e: any) => fade(e, 0.95, 0.15, 0.5),
        "target-arrow-color": (e: any) => fade(e, 0.95, 0.15, 0.5),
        width: (e: any) => Math.max(1.2, 3 - 0.7 * (deep(e) - 1)),
        "target-arrow-shape": "none",
      },
    },
    { selector: "edge.ref", style: { "line-color": t.edge.color, "target-arrow-shape": "triangle", "target-arrow-color": t.edge.color, width: 1.4 } },
  ];
}

/** 底色是不是深色 */
function isDarkCanvas(hex: string): boolean {
  const c = rgb(hex);
  return !!c && (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255 < 0.5;
}

/** 节点里一行字最宽多少像素 */
const NODE_WIDTH = 160;
/** 备注一行最宽多少：比节点略窄，看起来挂在节点底下，不会比节点宽出一大截 */
const NOTE_WIDTH = 150;

export function styleFor(
  themeKey: string,
  dir: Direction,
  fontFamily: string,
  line: LineMode,
  structure: Structure = "logic",
): any[] {
  const t = THEMES[themeKey] ?? THEMES[DEFAULT_THEME];
  const along = dir === "LR" ? "horizontal" : "vertical"; // 沿主线方向
  const labelBox = {
    "font-family": fontFamily,
    "font-size": 12,
    color: t.edge.label,
    "text-background-color": t.canvas,
    "text-background-opacity": 1,
    "text-background-padding": 4,
    "text-background-shape": "round-rectangle",
  };

  // 节点和备注的字自己断行（见 wrap.ts），绘图库只照着 \n 画；text-max-width 放宽，免得它再切一次
  const wrapped = (ele: any): string => {
    const text = String(ele.data("label") ?? "");
    if (ele.hasClass("note")) return wrapCached(text, NOTE_WIDTH, `400 11px ${fontFamily}`, 11);
    const root = ele.hasClass("root");
    const px = root ? 15 : 14;
    const weight = ele.hasClass("strong") ? 700 : root ? 600 : 500;
    return wrapCached(text, NODE_WIDTH, `${weight} ${px}px ${fontFamily}`, px);
  };
  const sheet: any[] = [
    {
      selector: "node",
      style: {
        label: wrapped,
        "font-family": fontFamily,
        "font-size": 14,
        "font-weight": 500,
        color: t.node.text,
        "text-valign": "center",
        "text-halign": "center",
        "text-wrap": "wrap",
        // 中文没有空格，必须允许在任意字之间断行，不然一长串字会把节点撑得很宽
        "text-overflow-wrap": "anywhere",
        "text-max-width": 1000,
        "line-height": 1.25,
        shape: t.node.shape,
        "corner-radius": 10,
        "background-color": t.node.bg,
        ...gradOf(t.node),
        ...shadowOf(t.node),
        "border-color": t.node.border,
        "border-width": t.node.borderWidth,
        width: "label",
        height: "label",
        padding: 14,
      },
    },
    {
      selector: "node.root",
      style: {
        "background-color": t.root.bg,
        ...gradOf(t.root),
        "border-color": t.root.border,
        color: t.root.text,
        "font-weight": 600,
      },
    },
    {
      selector: "node.end",
      style: {
        "background-color": t.end.bg,
        ...gradOf(t.end),
        "border-color": t.end.border,
        color: t.end.text,
        "border-width": Math.max(t.node.borderWidth, 1.5),
      },
    },
    { selector: "node.strong", style: { "font-weight": 700 } },
    {
      // 概要：`} 概要` 那一行。是个真节点，用虚线框和普通节点区分开
      selector: "node.summary-node",
      style: {
        "background-color": t.node.bg,
        "border-color": t.edge.color,
        "border-width": Math.max(t.node.borderWidth, 1.2),
        "border-style": "dashed",
        color: t.node.text,
        "font-weight": 500,
      },
    },
    {
      // 只写了一个 } 的概要：没有字，是一个看不见的点，括号的尖对着它
      selector: "node.ghost",
      style: { width: 1, height: 1, padding: 0, label: "", "background-opacity": 0, "border-width": 0, "shadow-blur": 0, events: "no" },
    },
    ...branchRules(t),
    ...linkRules(t),
    { selector: "node:grabbed", style: { "border-width": 2, "border-color": t.root.bg } },
    ...selectRules(t),
    {
      // 备注：节点正下方的小字，不能单独拖，跟着节点走；点一下收起成「···」，再点展开
      selector: "node.note",
      style: {
        shape: "rectangle",
        "background-opacity": 0,
        "background-fill": "solid",
        "shadow-blur": 0,
        "border-width": 0,
        "font-size": 11,
        "font-weight": 400,
        color: t.edge.label,
        "text-wrap": "wrap",
        "text-overflow-wrap": "anywhere",
        "text-max-width": 1000,
        padding: 2,
        "text-background-color": t.canvas,
        "text-background-opacity": 0.9,
        "text-background-padding": 2,
      },
    },
    {
      // 收起来的备注：只剩三个点，提示这里有备注
      selector: "node.note.folded",
      style: { "font-size": 13, "font-weight": 700, "text-background-opacity": 0 },
    },
    {
      selector: "edge",
      style: {
        width: t.edge.width,
        "line-color": t.edge.color,
        "target-arrow-shape": "triangle",
        "target-arrow-color": t.edge.color,
        "arrow-scale": 1,
        label: "data(label)",
        ...labelBox,
      },
    },
    { selector: "edge.ref", style: { "line-style": "dashed", "line-dash-pattern": [6, 4] } },
  ];

  if (line === "poly") {
    const taxi = t.edge.round ? "round-taxi" : "taxi";
    sheet.push(
      // 拐弯的地方离父节点固定 20 像素，同一个父节点出去的几条线才会共用一根竖线；
      // 按百分比拐的话，子节点宽窄不一，竖线就会错开成好几根
      { selector: "edge", style: { "curve-style": taxi, "taxi-direction": along, "taxi-radius": 10, "taxi-turn": 20, "taxi-turn-min-distance": 6 } },
      // 正下方的支线：先垂直主线走
      { selector: "edge.drop", style: { "taxi-direction": dir === "LR" ? "vertical" : "horizontal" } },
      // 排开的支线几条共用一段竖线，字写在靠近终点的那一段上才不会叠
      // 偏多少按字的长度算：正好落在目标前面那段横线的中间，不压箭头、也不跑到竖线上去
      {
        selector: "edge.elbow",
        style: { label: "", "target-label": "data(label)", "target-text-offset": (e: any) => labelSize(e.data("label") ?? "").w / 2 + 12 },
      },
      // 引用线：两头不在一排的走普通折线；在同一排或同一列的，从外侧绕一个方框（位置由代码算）
      { selector: "edge.ref", style: { "taxi-direction": "auto", "taxi-turn": "50%" } },
      {
        selector: "edge.ref-u",
        style: { "curve-style": t.edge.round ? "round-segments" : "segments", "segment-radius": 10, "segment-weights": "0 1" },
      },
    );
  } else if (line === "straight") {
    // 直线：所有线都是直的。只有引用线弯一下，否则回路的箭头会正好压在主线上面看不出来。
    sheet.push(
      { selector: "edge", style: { "curve-style": "straight" } },
      {
        selector: "edge.ref",
        style: { "curve-style": "unbundled-bezier", "control-point-distances": bow, "control-point-weights": 0.5 },
      },
    );
  } else {
    // 弧线：思维导图那种 S 形——顺着排布方向平着出去、平着进来，两头在一条线上时就是直的。
    // 每条线的两个控制点由 curve.ts 按两头的位置算好、逐条写到边上；这里的 0 只是兜底（一条直线）。
    sheet.push(
      // edge-distances 同上：控制点是按两头节点的中心算的
      {
        selector: "edge",
        style: {
          "curve-style": "unbundled-bezier",
          "edge-distances": "node-position",
          "control-point-distances": "0 0",
          "control-point-weights": "0.33 0.67",
        },
      },
      {
        // 引用线弯得更狠一点，不然和主线糊在一起
        selector: "edge.ref",
        style: { "curve-style": "unbundled-bezier", "control-point-distances": bow, "control-point-weights": 0.5 },
      },
    );
  }

  // 树状结构（思维导图、逻辑图、组织结构图）：线上的字一律贴着终点那头写。
  // 几条线从同一个父节点出来时共用前半段，字写在中间会叠在一起、压在别的线上；终点那段每条线各走各的，不会叠。
  if (structure === "mindmap" || structure === "logic" || structure === "org" || structure === "trunk") {
    const offset = (e: any) => {
      const l = labelSize(e.data("label") ?? "");
      return dir === "LR" ? l.w / 2 + 10 : l.h / 2 + 10;
    };
    sheet.push(
      { selector: "edge", style: { label: "", "target-label": "data(label)", "target-text-offset": offset } },
      // 引用线（回指的虚线）两头离得远，字还是写在中间
      { selector: "edge.ref", style: { label: "data(label)", "target-label": "" } },
    );
  }

  // 结构专属的线
  if (structure === "fishbone") {
    // 鱼骨图的线都是折好的直线段：主干和斜骨的拐点由 fish.ts 逐条算好写上去。不带箭头，主干加粗
    // edge-distances 必须是 node-position：拐点是按两头节点的中心算的；默认值是按线和节点边框的交点量，会整体偏掉
    const seg = {
      "curve-style": "segments",
      "edge-distances": "node-position",
      "segment-weights": "0.5",
      "segment-distances": "0",
      "target-arrow-shape": "none",
    };
    sheet.push(
      { selector: "edge", style: { "target-arrow-shape": "none" } },
      { selector: "edge.spine", style: { ...seg, width: t.edge.width + 1.4 } },
      { selector: "edge.rib", style: { ...seg, label: "", "target-label": "data(label)", "target-text-offset": (e: any) => labelSize(e.data("label") ?? "").w / 2 + 6 } },
      { selector: "edge.twig", style: { "curve-style": t.edge.round ? "round-taxi" : "taxi", "taxi-direction": "vertical", "taxi-radius": 6 } },
      { selector: "edge.ref", style: { "curve-style": "unbundled-bezier", "control-point-distances": bow, "control-point-weights": 0.5 } },
      { selector: "node.root", style: { "font-size": 15 } },
    );
  }
  if (structure === "timeline") {
    // 时间轴的线和主轴平行或垂直，一律拉直；主干加粗，挂线细一点、不带箭头（像刻度）
    sheet.push(
      { selector: "edge", style: { "curve-style": "straight" } },
      { selector: "edge.spine", style: { width: t.edge.width + 1.1 } },
      { selector: "edge.mark", style: { width: 1.2, "target-arrow-shape": "none" } },
    );
  }
  if (structure === "flow") {
    // 流程图的三种框：起点和终点是两头全圆的胶囊，判断是菱形，其余是直角稍圆的方框
    sheet.push(
      { selector: "node", style: { shape: "round-rectangle", "corner-radius": 4 } },
      { selector: "node.root, node.end", style: { "corner-radius": 999 } },
      {
        selector: "node.decision",
        style: { shape: "round-diamond", "corner-radius": 6, padding: 26, "text-max-width": 96 },
      },
      { selector: "node.summary-node", style: { "corner-radius": 4 } },
    );
  }
  if (structure === "radial") {
    // 发散图的线按圆来画（见 radial.ts）：直线拉直；折线绕着圈拐；弧线是两个控制点的弯线
    const ray = line === "poly" ? { "curve-style": t.edge.round ? "round-segments" : "segments", "segment-radius": 6 } : line === "curve" ? { "curve-style": "unbundled-bezier" } : { "curve-style": "straight" };
    sheet.push({ selector: "edge.ray", style: { ...ray, "edge-distances": "node-position" } });
  }
  if (structure === "brace") {
    // 括号图不用箭头，靠大括号分组
    sheet.push({ selector: "edge", style: { "target-arrow-shape": "none" } });
  }

  sheet.push(...branchEdgeRules(t));

  // 成环的内容（见 ring.ts）：环上的线一律拉直、带箭头（生克有方向），字写在线的中间。
  // 相生是实线（外圈），相克是虚线（里面的星）；把环合上的那条引用线画得和相生一样
  const ringColor = t.branches
    ? (e: any) => {
        const pal = t.branches!.palette;
        return mix(pal[((e.data("br") ?? 0) % pal.length + pal.length) % pal.length], t.canvas, 0.85);
      }
    : t.edge.color;
  sheet.push(
    { selector: "edge.ring", style: { "curve-style": "straight", label: "data(label)", "target-label": "", "target-arrow-shape": "triangle", "arrow-scale": 0.9, width: 2 } },
    { selector: "edge.ring.ref", style: { width: 1.3 } },
    { selector: "edge.ring-close", style: { "line-style": "solid", width: 2, "line-color": ringColor, "target-arrow-color": ringColor } },
  );

  // 概要花括号必须放在最后一条。
  // cytoscape 的样式表是「按出现顺序逐条应用、同属性后者覆盖前者」，不看选择器特异性；
  // 上面各分支都会给通用 edge 设 curve-style，放前面就会被它盖回 taxi，花括号直接画不出来。
  sheet.push({
    // 花括号两头的锚点：看不见、不能拖、不接收事件，只用来把脊线拉直
    selector: "node.summary-anchor",
    style: {
      width: 1,
      height: 1,
      padding: 0, // 通用节点有 14 的 padding，不清掉的话这个「点」实际有 29 宽
      shape: "rectangle",
      "background-opacity": 0,
      "background-fill": "solid",
      "shadow-blur": 0,
      "border-width": 0,
      label: "",
      events: "no",
    },
  });

  // 鼓出方向是实测出来的（visual/diag.html 那种量法），不是推的：
  // segment-distances 取正值时，竖直的线（上→下）被推到屏幕左、水平的线（左→右）被推到屏幕下。
  // 所以 LR 要往右鼓得给负值，TB 要往下鼓得给正值。
  const summaryStyle = (out: number) => ({
    width: 2,
    "line-color": t.edge.color,
    "curve-style": "round-segments",
    // 五个控制点连成 } 的轮廓。这里的数只是兜底：实际的位置由 brace.ts 按像素算好、逐条写到边上，
    // 这样弯钩和尖角大小固定，不随括号长短变形。
    "segment-weights": [0.04, 0.4, 0.5, 0.6, 0.96],
    "segment-distances": [16 * out, 16 * out, 28 * out, 16 * out, 16 * out],
    "segment-radius": 6,
    "target-arrow-shape": "none",
    "source-arrow-shape": "none",
    // 两头接在锚点中心（锚点摆在整组的外沿上，见 brace.ts 的 placeBraces）
    // 必须写 inside-to-node（节点中心）。写成 "50% 50%" 是「从中心偏出去半个节点」，
    // 而锚点会继承通用节点的 padding，实际偏出去十几个像素——括号的两头就歪到一边、下端还多出一截。
    "source-endpoint": "inside-to-node",
    "target-endpoint": "inside-to-node",
    // 字写在概要节点上，线上不写
    label: "",
  });
  // 概要：`} 组名` 写在节点之后，尖朝外（远离节点）
  sheet.push({ selector: "edge.summary", style: summaryStyle(dir === "LR" ? -1 : 1) });
  // 括号图：大括号夹在父节点和子节点中间，尖朝父节点，方向正好相反
  sheet.push({ selector: "edge.brace", style: summaryStyle(dir === "LR" ? 1 : -1) });
  return sheet;
}
