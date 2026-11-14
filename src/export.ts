// 把一篇笔记里的流程图导成一个单文件网页。
// 这里只管「拼出网页文字」和「从笔记里找出要导出的图」，都是纯函数；读写文件在 main.ts 的 exportNote。
import stageCss from "../styles.css";
import { Lang, getLang, t } from "./i18n";
import { CHARTS_ID, DATA_ID } from "./page-ids";
import { HEADING, extractOutlineFromMarkdown, findFlowBlocks, inlineMarkdown } from "./graph";
import type { DiagramData, Settings } from "./main";

export interface ExportChart {
  /** 存位置用的 id：flow 代码块是 "0"、"1"…，整篇大纲是 "__outline__"，和插件里完全一致，位置才对得上 */
  id: string;
  title: string;
  source: string;
  data: DiagramData;
}

export interface ExportPayload {
  title: string;
  /** YYYY-MM-DD */
  date: string;
  charts: ExportChart[];
  settings: Pick<Settings, "theme" | "direction" | "line" | "structure" | "snap" | "height">;
  /** 导出时的界面语言：网页的 lang、日期那行、按钮、提示都用它。老数据没有这一项，按中文 */
  lang?: Lang;
  /** 主题照存的用，不跟着看的人的系统深浅色换（挑主题的预览页用） */
  fixedTheme?: boolean;
}

/** 标题里的 Markdown 记号去掉，只留看得见的字 */
function plainTitle(text: string): string {
  return inlineMarkdown(text).text.replace(/\\(.)/g, "$1").trim();
}

/**
 * 找出这篇笔记要导出的图，规则和侧栏完全一样（见 main.ts 的 SideView.refresh）：
 * 有 flow 代码块就是每个代码块一张，id 是它的序号；一个都没有，就把整篇正文大纲当一张，id 是 "__outline__"。
 * 每张图的名字：代码块上面最近的一个标题；没有标题就叫「图 N」。整篇大纲用笔记名。
 */
export function collectCharts(markdown: string, noteTitle: string): { id: string; title: string; source: string }[] {
  const blocks = findFlowBlocks(markdown);
  if (blocks.length === 0) {
    const outline = extractOutlineFromMarkdown(markdown);
    return outline.trim() ? [{ id: "__outline__", title: noteTitle, source: outline }] : [];
  }
  // 每一行上面最近的标题。围栏代码块和开头的属性区里的 # 不是标题
  const lines = markdown.split("\n");
  const headingAt: (string | null)[] = [];
  let current: string | null = null;
  let inFence = false;
  let inFront = lines[0]?.trimEnd() === "---";
  lines.forEach((raw, i) => {
    const line = raw.trimEnd();
    headingAt.push(current);
    if (i === 0 && inFront) return;
    if (inFront) {
      if (line === "---") inFront = false;
      return;
    }
    if (/^\s*(`{3,}|~{3,})/.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    const h = HEADING.exec(line);
    if (h) current = plainTitle(h[2]) || null;
  });
  return blocks.map((b) => ({
    id: String(b.index),
    title: headingAt[b.start] ?? t("export.chartN", { n: b.index + 1 }),
    source: b.source,
  }));
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/**
 * 网页自己的样式：深浅色两套变量，加上标题和页面的排版。
 * 图和卡片的样式用的是 Obsidian 的变量（styles.css 是同一份），这里把它们映射到网页自己的颜色上。
 */
const PAGE_CSS = `
:root {
  color-scheme: light dark;
  --page: #f4f5f7;
  --card: #ffffff;
  --line: #e3e6ec;
  --text: #1d2129;
  --sub: #6b7280;
  --accent: #2f6bff;
  --hover: #eef0f4;
  --shadow: 0 6px 24px #0b122026;
  --warn: #b45309;
  --error: #c0262d;
}
@media (prefers-color-scheme: dark) {
  :root {
    --page: #14171c;
    --card: #1a1e25;
    --line: #2a303b;
    --text: #e6e9ef;
    --sub: #8b93a1;
    --accent: #7aa5ff;
    --hover: #242a33;
    --shadow: 0 6px 24px #00000066;
    --warn: #e3c46b;
    --error: #ff8a8f;
  }
}
:root {
  /* Obsidian variables used by styles.css, mapped to the colors above */
  --background-primary: var(--card);
  --background-secondary: var(--page);
  --background-modifier-border: var(--line);
  --background-modifier-hover: var(--hover);
  --text-normal: var(--text);
  --text-muted: var(--sub);
  --text-accent: var(--accent);
  --interactive-accent: var(--accent);
  --text-warning: var(--warn);
  --text-error: var(--error);
  --shadow-s: var(--shadow);
  --border-width: 1px;
  --radius-s: 8px;
  --radius-m: 10px;
  --radius-l: 16px;
  --size-2-1: 2px;
  --size-2-2: 4px;
  --size-4-1: 4px;
  --size-4-2: 8px;
  --size-4-3: 12px;
  --size-4-4: 16px;
  --size-4-6: 24px;
  --font-ui-smaller: 12px;
  --font-ui-small: 13px;
  --font-ui-medium: 15px;
  --font-semibold: 600;
}
* { box-sizing: border-box; }
html { background: var(--page); }
body {
  margin: 0;
  background: var(--page);
  color: var(--text);
  font: 15px/1.6 system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
}
main { max-width: 1100px; margin: 0 auto; padding: 40px 16px 80px; }
h1 { font-size: 28px; line-height: 1.3; margin: 0 0 4px; font-weight: 700; overflow-wrap: anywhere; }
.meta { color: var(--sub); font-size: 13px; margin-bottom: 28px; }
@media (max-width: 600px) {
  main { padding-top: 24px; }
  h1 { font-size: 22px; }
}
`;

/** 网页里的 JSON：把 < 换成 <，数据里写了 </script> 也跳不出 script 标签 */
function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

/** 内联进 script 的脚本：不能出现 </script，也不能出现 <!--（浏览器会当成注释的开头） */
function safeScript(code: string): string {
  return code.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");
}

/**
 * 拼出完整的网页：标题、几张图、样式、数据和查看器脚本都在里面，打开不需要联网。
 * viewerCode 是 src/web.ts 打出来的那段脚本，构建时由 esbuild 注入。
 */
export function buildExportHtml(payload: ExportPayload, viewerCode: string): string {
  const title = escapeHtml(payload.title);
  const lang = payload.lang ?? getLang();
  const n = payload.charts.length;
  const meta = escapeHtml(t(n === 1 ? "export.metaOne" : "export.meta", { n, date: payload.date }, lang));
  return `<!doctype html>
<html lang="${lang === "zh" ? "zh-CN" : "en"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${title}</title>
<style>${PAGE_CSS}${stageCss}</style>
</head>
<body>
<main>
<h1>${title}</h1>
<div class="meta">${meta}</div>
<div id="${CHARTS_ID}"></div>
</main>
<script type="application/json" id="${DATA_ID}">${safeJson(payload)}</script>
<script>${safeScript(viewerCode)}</script>
</body>
</html>
`;
}
