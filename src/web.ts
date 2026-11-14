// 导出网页里跑的脚本：读页面里的数据，给每张图建一个只读的 FlowView。
// 画图用的是和插件同一套代码，所以网页上看到的和笔记里一样。
// 打包方式见 esbuild.config.mjs：IIFE，"obsidian" 指到 src/web-obsidian.ts，整段内联进网页。
import type { ExportPayload } from "./export";
import { FlowView } from "./main";
import type { NoteData } from "./main";
import { setLang } from "./i18n";
import { CHARTS_ID, DATA_ID } from "./page-ids";
import { DEFAULT_THEME, THEMES, themeForMode } from "./themes";

function start() {
  const node = document.getElementById(DATA_ID);
  const host = document.getElementById(CHARTS_ID);
  if (!node || !host) return;
  const payload: ExportPayload = JSON.parse(node.textContent ?? "{}");
  // 界面语言用导出时存的那个；老网页里没有这一项，按中文。要在建图之前设，按钮、提示、主题名都跟着它走
  setLang(payload.lang ?? "zh");

  // 网页里没有 Obsidian 的插件对象：FlowView 要的那几个方法给空实现，设置和位置数据来自导出时存的那份
  const note: NoteData = { version: 1, diagrams: {} };
  const plugin: any = {
    settings: payload.settings,
    track() {},
    untrack() {},
    broadcast() {},
    saveNote: () => Promise.resolve(),
    loadNote: () => Promise.resolve(note),
    viewportKey: (p: string | null, d: string) => `${p ?? ""}\u0000${d}`,
    rememberViewport() {},
    recallViewport: () => null,
  };

  const dark = window.matchMedia("(prefers-color-scheme: dark)");
  const charts: { view: FlowView; base: string; data: NoteData["diagrams"][string] }[] = [];

  for (const c of payload.charts) {
    note.diagrams[c.id] = c.data;
    // 这张图存的主题；没存过就用导出时的默认主题
    const saved = c.data.theme;
    const base = saved && THEMES[saved] ? saved : THEMES[payload.settings.theme] ? payload.settings.theme : DEFAULT_THEME;
    c.data.theme = payload.fixedTheme ? base : themeForMode(base, dark.matches);
    const el = document.createElement("div");
    host.appendChild(el);
    const view = new FlowView(el, plugin, c.source, null, c.id, note, { readonly: true, title: c.title });
    view.load();
    charts.push({ view, base, data: c.data });
    // 给截图、检查脚本用：在页面的控制台里能拿到每张图
    ((window as any).__outlineFlow ??= []).push(view);
  }

  // 系统深浅色变了（比如到了晚上自动切深色）：每张图的主题跟着换，页面本身的颜色由 CSS 的 prefers-color-scheme 管
  const onModeChange = () => {
    for (const c of charts) {
      c.data.theme = payload.fixedTheme ? c.base : themeForMode(c.base, dark.matches);
      c.view.syncFromData();
    }
  };
  if (dark.addEventListener) dark.addEventListener("change", onModeChange);
  else (dark as any).addListener?.(onModeChange); // 老 Safari
}

start();
