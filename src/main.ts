import {
  App,
  ItemView,
  MarkdownPostProcessorContext,
  MarkdownView,
  WorkspaceLeaf,
  MarkdownRenderChild,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TAbstractFile,
  TFile,
  normalizePath,
  Platform,
} from "obsidian";
import * as obsidian from "obsidian";
import cytoscape from "cytoscape";
import { BraceSpec, addBraces, bracesFrom, placeBraces } from "./brace";
import { applyCurves } from "./curve";
import { routeFish } from "./fish";
import { routeRadial } from "./radial";
import { LEGACY_FOLDER, detectLang, getLang, setLang, t } from "./i18n";
import { Picker } from "./picker";
import { snapTo } from "./snap";
import { assignBranches } from "./branch";
import { findRings, markRings, placeRings } from "./ring";
import type { Ring } from "./ring";
import { buildExportHtml, collectCharts, ExportPayload } from "./export";
import { Applied, EditOp, diffRange, lineIsNode, locate, readNodeText, sourceTree, targetOf, applyEdit, diagramSource } from "./edit";
import { BLOCK_LANG, LinkInfo, buildElements, extractOutlineFromMarkdown, findFlowBlocks, toFlowchartFun } from "./graph";
import { layoutPoints } from "./pack";
import { gate, pickDiagram } from "./side";
import {
  DEFAULT_STRUCTURE,
  DEFAULT_THEME,
  Direction,
  GRID,
  LineMode,
  Structure,
  THEMES,
  axisFor,
  followsDirection,
  lineFor,
  liveStructure,
  structureName,
  structureOptions,
  themeGroups,
  themeName,
  styleFor,
} from "./themes";
import { WheelKind, wheelAction, wheelKind } from "./wheel";

const SIDE_VIEW = "outline-flow-side";
/** 导出的网页放在库里的这个文件夹（名字跟着界面语言走，用的时候才取） */
const exportFolder = () => t("export.folder");
/** 导出的网页里，图的高度不会低于这个值（像素） */
const EXPORT_MIN_HEIGHT = 240;
const MIN_HEIGHT = 200;
const MAX_HEIGHT = 1200;
export interface Settings {
  folder: string;
  theme: string;
  direction: Direction;
  line: LineMode;
  structure: Structure;
  /** 拖完节点自动对到小格子上 */
  snap: boolean;
  height: number;
  /** 新图的样式：last 跟上一张改过的图一样；fixed 用设置里选定的主题和结构 */
  newStyle: "last" | "fixed";
}

const DEFAULTS: Settings = {
  folder: LEGACY_FOLDER, // 老版本的默认值；新装的按语言选，见 onload
  theme: DEFAULT_THEME,
  direction: "LR",
  line: "poly",
  structure: DEFAULT_STRUCTURE,
  snap: true,
  height: 420,
  newStyle: "last",
};

export interface Point {
  x: number;
  y: number;
}

/** 一张图自己的状态：结构在大纲里，这里只有位置和外观 */
export interface DiagramData {
  theme?: string;
  direction?: Direction;
  line?: LineMode;
  structure?: Structure;
  /** 备注是不是显示着；没设过就是显示 */
  notes?: boolean;
  /** 关联的靠近排：同级节点按虚线的关系重新排先后（只是图上的顺序，大纲不动） */
  nearRefs?: boolean;
  /** 单独收起来的备注：记的是节点的 key */
  notesFolded?: string[];
  pos: Record<string, Point>;
}

export interface Viewport {
  zoom: number;
  pan: Point;
}

export interface NoteData {
  version: 1;
  diagrams: Record<string, DiagramData>;
}

/** 撤回栈里的一步：拖了节点（位置前后各一份）或改了大纲（笔记前后各一份全文） */
export interface PosEntry {
  kind: "pos";
  before: Record<string, Point>;
  after: Record<string, Point>;
}
export interface TextEntry {
  kind: "text";
  before: string;
  after: string;
  /** 这一步之前 / 之后选中的节点在笔记里的行号 */
  selBefore: number | null;
  selAfter: number | null;
}
export type HistoryEntry = PosEntry | TextEntry;
export interface History {
  undo: HistoryEntry[];
  redo: HistoryEntry[];
}
/** 每张图最多记这么多步 */
const HISTORY_MAX = 100;

/** 改完笔记、图重画之后，要选中哪个节点、要弹什么提示 */
interface Pending {
  /** 节点在新图的源文本里的行号（从 1 数）；没有要选的是 null */
  srcLine: number | null;
  /** 新图的源文本：重画出来的内容对得上才用，免得被中间的旧画面抢先用掉 */
  source: string;
  toast?: string;
  at: number;
}
/** 超过这么久还没等到重画，就不选了 */
const PENDING_MS = 5000;

export interface EditRequest {
  notePath: string;
  diagramId: string;
  /** 图现在显示的源文本 */
  source: string;
  op: EditOp;
}
export type EditOutcome = { ok: true } | { ok: false; reason: string };

const isMac = () => /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);
const clonePos = (pos: Record<string, Point>): Record<string, Point> =>
  Object.fromEntries(Object.entries(pos).map(([k, v]) => [k, { x: v.x, y: v.y }]));
const samePos = (a: Record<string, Point>, b: Record<string, Point>) => {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => b[k] && a[k].x === b[k].x && a[k].y === b[k].y);
};
const trimEnd = (s: string) => s.replace(/\s+$/, "");

export default class OutlineFlowPlugin extends Plugin {
  settings: Settings = { ...DEFAULTS };
  private cache = new Map<string, NoteData>();
  /** 同一篇笔记里的几张图会同时来读，必须拿到同一份数据，不然后保存的会盖掉先保存的 */
  private loading = new Map<string, Promise<NoteData>>();
  private writing = new Map<string, Promise<void>>();
  /** 正在显示的所有图。同一张图可能同时出现在笔记里和侧栏里，一边改了另一边要跟上 */
  private views = new Set<FlowView>();
  /** 每张图上次的缩放和位置。代码块重渲染会换新实例，靠它把视角接回来 */
  private viewports = new Map<string, Viewport>();
  /** 每张图的撤回栈。放在插件上：代码块一改就会换新的 FlowView，栈不能跟着丢 */
  private histories = new Map<string, History>();
  /** 每张图改完笔记后要选中的节点 */
  private pending = new Map<string, Pending>();

  /**
   * 跳到笔记里含有这段字的那一行（图下面「去这一行」用）。
   * 按字找而不是按行号找：侧栏整篇大纲模式里，图的行号和笔记的行号对不上。
   */
  async revealLine(notePath: string, find: string): Promise<void> {
    const leaf = this.app.workspace
      .getLeavesOfType("markdown")
      .find((l) => l.view instanceof MarkdownView && l.view.file?.path === notePath);
    if (!leaf) return;
    const view = leaf.view as MarkdownView;
    const lines = view.editor.getValue().split("\n");
    const want = find.trim();
    let at = lines.findIndex((l) => l.trim() === want);
    if (at < 0) at = lines.findIndex((l) => l.includes(want));
    if (at < 0) return;
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
    if (view.getMode() !== "source") {
      // 阅读模式下没有光标，先切到编辑模式再定位
      await view.setState({ ...view.getState(), mode: "source" }, { history: false });
    }
    const from = { line: at, ch: 0 };
    const to = { line: at, ch: lines[at].length };
    view.editor.setSelection(from, to);
    view.editor.scrollIntoView({ from, to }, true);
  }

  viewportKey(notePath: string | null, diagramId: string): string {
    return `${notePath ?? ""}\u0000${diagramId}`;
  }
  rememberViewport(key: string, v: Viewport | null) {
    if (v) this.viewports.set(key, v);
    else this.viewports.delete(key); // 重新摆正过就别再记着旧视角
  }
  recallViewport(key: string): Viewport | null {
    return this.viewports.get(key) ?? null;
  }

  // ---------- 撤回栈 ----------

  history(key: string): History {
    let h = this.histories.get(key);
    if (!h) this.histories.set(key, (h = { undo: [], redo: [] }));
    return h;
  }
  /** 记下新的一步：重做栈清空，只留最近 HISTORY_MAX 步 */
  pushHistory(key: string, entry: HistoryEntry) {
    const h = this.history(key);
    h.undo.push(entry);
    if (h.undo.length > HISTORY_MAX) h.undo.splice(0, h.undo.length - HISTORY_MAX);
    h.redo = [];
  }
  /** 换结构、换方向会把位置清空，之前记的拖动位置对不上了 */
  dropPosHistory(key: string) {
    const h = this.histories.get(key);
    if (!h) return;
    h.undo = h.undo.filter((e) => e.kind !== "pos");
    h.redo = h.redo.filter((e) => e.kind !== "pos");
  }

  // ---------- 在图上改笔记 ----------

  /** 这篇笔记正开在编辑模式（含实时预览）的话，返回那个视图；改字要走它的编辑器，编辑器自己的撤回才跟得上 */
  private editorView(notePath: string): MarkdownView | null {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const v = leaf.view;
      if (v instanceof MarkdownView && v.file?.path === notePath && v.getMode() === "source") return v;
    }
    return null;
  }

  /** 笔记现在的全文：开着编辑器就读编辑器里的（磁盘上的可能落后一两秒），不然读库里的 */
  async readNoteText(notePath: string): Promise<string | null> {
    const md = this.editorView(notePath);
    if (md) return md.editor.getValue();
    const file = this.app.vault.getAbstractFileByPath(notePath);
    return file instanceof TFile ? this.app.vault.cachedRead(file) : null;
  }

  /**
   * 改笔记。compute 拿到笔记现在的全文，返回改完的全文；返回 null 或没变就不写。
   * 开着编辑器就用一次事务只改变化的那一段（编辑器自己的撤回也能撤，光标不会被甩开）；不然用 vault.process。
   * 返回改之前和改之后的全文；没改是 null；找不到笔记是 "missing"。
   */
  private async writeNote(notePath: string, compute: (cur: string) => string | null): Promise<{ before: string; after: string } | null | "missing"> {
    const md = this.editorView(notePath);
    if (md) {
      const editor = md.editor;
      const cur = editor.getValue();
      const next = compute(cur);
      if (next === null || next === cur) return null;
      const d = diffRange(cur, next);
      editor.transaction({ changes: [{ from: editor.offsetToPos(d.from), to: editor.offsetToPos(d.to), text: d.insert }] });
      return { before: cur, after: next };
    }
    const file = this.app.vault.getAbstractFileByPath(notePath);
    if (!(file instanceof TFile)) return "missing";
    let done: { before: string; after: string } | null = null;
    await this.app.vault.process(file, (data) => {
      const next = compute(data);
      if (next === null || next === data) return data;
      done = { before: data, after: next };
      return next;
    });
    return done;
  }

  /** 把「改完要选中哪个节点」记下来，等图重画出来时用 */
  private setPending(key: string, text: string, diagramId: string, line: number | null, toast?: string) {
    const at = locate(text, targetOf(diagramId), line);
    this.pending.set(key, { srcLine: at.srcLine, source: trimEnd(at.source), toast, at: Date.now() });
  }

  /**
   * 图重画时来取：内容对得上才给（返回行号和要弹的提示），取走就删。
   * 还没等到对的内容就先留着；等太久的作废。
   */
  takePending(notePath: string | null, diagramId: string, source: string): { srcLine: number | null; toast?: string } | null {
    const key = this.viewportKey(notePath, diagramId);
    const p = this.pending.get(key);
    if (!p) return null;
    if (Date.now() - p.at > PENDING_MS) {
      this.pending.delete(key);
      return null;
    }
    if (p.source !== trimEnd(source)) return null;
    this.pending.delete(key);
    return { srcLine: p.srcLine, toast: p.toast };
  }

  /** 在图上改了一处：改笔记、记进撤回栈、记下改完要选中的节点 */
  async editNode(req: EditRequest): Promise<EditOutcome> {
    const target = targetOf(req.diagramId);
    let applied: Applied | null = null;
    let failure = "";
    let selBefore: number | null = null;
    const done = await this.writeNote(req.notePath, (cur) => {
      const r = applyEdit(cur, target, req.source, req.op);
      if (!r.ok) {
        failure = r.reason;
        return null;
      }
      applied = r;
      selBefore = diagramSource(cur, target)?.lines[req.op.line - 1] ?? null;
      return r.text;
    });
    if (done === "missing") return { ok: false, reason: t("edit.noteNotFound") };
    const a = applied as Applied | null;
    if (!a) return { ok: false, reason: failure || t("edit.failed") };
    if (!done) return { ok: true }; // 改完和原来一样，什么都没动
    const key = this.viewportKey(req.notePath, req.diagramId);
    this.pushHistory(key, { kind: "text", before: done.before, after: done.after, selBefore, selAfter: a.line });
    this.setPending(key, done.after, req.diagramId, a.line);
    if (a.notice) new Notice(isMac() ? a.notice : a.notice.replace("⌘Z", "Ctrl+Z"));
    return { ok: true };
  }

  /** 先不写笔记，算出改完以后图的源文本和新节点在第几行：加节点时先按这个排一遍，节点直接出现在它最终的位置 */
  async previewEdit(req: EditRequest): Promise<{ ok: true; source: string; srcLine: number | null } | { ok: false; reason: string }> {
    const text = await this.readNoteText(req.notePath);
    if (text === null) return { ok: false, reason: t("edit.noteNotFound") };
    const r = applyEdit(text, targetOf(req.diagramId), req.source, req.op);
    if (!r.ok) return r;
    return { ok: true, source: r.source, srcLine: r.srcLine };
  }

  /** 取一个节点的原文给编辑框用 */
  async nodeText(req: { notePath: string; diagramId: string; source: string; line: number }): Promise<string | null> {
    const text = await this.readNoteText(req.notePath);
    return text === null ? null : readNodeText(text, targetOf(req.diagramId), req.source, req.line);
  }

  /**
   * 撤回或重做一步改大纲：笔记现在的全文必须正好等于这一步改完（撤回）或改之前（重做）的样子才动手；
   * 别处改过了就不动，给个提示。返回做没做成。
   */
  async rewriteText(notePath: string, diagramId: string, entry: TextEntry, dir: "undo" | "redo"): Promise<boolean> {
    const from = dir === "undo" ? entry.after : entry.before;
    const to = dir === "undo" ? entry.before : entry.after;
    const done = await this.writeNote(notePath, (cur) => (cur === from ? to : null));
    if (!done) {
      new Notice(dir === "undo" ? t("undo.conflict") : t("redo.conflict"));
      return false;
    }
    this.setPending(this.viewportKey(notePath, diagramId), to, diagramId, dir === "undo" ? entry.selBefore : entry.selAfter, dir === "undo" ? t("toast.undone") : t("toast.redone"));
    return true;
  }

  /** 打开双链：和 Obsidian 里 ⌘+单击一样，开在新标签页 */
  openNoteLink(target: string, sourcePath: string) {
    void this.app.workspace.openLinkText(target, sourcePath, true);
  }

  track(view: FlowView) {
    this.views.add(view);
  }
  untrack(view: FlowView) {
    this.views.delete(view);
  }
  broadcast(from: FlowView) {
    for (const v of this.views) if (v !== from && v.sameDiagram(from)) v.syncFromData();
  }

  async onload() {
    // 先定界面语言：后面注册的命令名、侧栏提示、设置页都要用对的语言
    setLang(detectLang(obsidian));
    const saved = await this.loadData();
    this.settings = { ...DEFAULTS, ...(saved ?? {}) };
    if (!THEMES[this.settings.theme]) this.settings.theme = DEFAULT_THEME;
    if (saved == null) {
      // 全新安装（一份设置都没存过）：位置文件夹按语言取个名字并存下来，以后切换语言也不会变。
      // 存过设置的老用户不动。没存过设置、但库里已经有老版本的默认文件夹的，继续用它，位置才不会丢。
      let folder = t("settings.folder.default");
      try {
        if (folder !== LEGACY_FOLDER && (await this.app.vault.adapter.exists(LEGACY_FOLDER))) folder = LEGACY_FOLDER;
      } catch {
        // 查不了就用按语言取的名字
      }
      this.settings.folder = folder;
      await this.saveSettings();
    }

    this.registerMarkdownCodeBlockProcessor(BLOCK_LANG, (source, el, ctx) => this.render(source, el, ctx));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => this.onRename(file, oldPath)));
    this.addSettingTab(new OutlineFlowSettingTab(this.app, this));

    this.registerView(SIDE_VIEW, (leaf) => new SideView(leaf, this));
    this.addRibbonIcon("workflow", t("command.openSide"), () => void this.openSide());
    this.addCommand({ id: "open-side", name: t("command.openSide"), callback: () => void this.openSide() });
    this.addCommand({
      id: "export-html",
      name: t("command.exportHtml"),
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "md") return false;
        if (!checking) void this.exportNote(file.path);
        return true;
      },
    });
  }

  /**
   * 把一篇笔记里的所有流程图导成一个单文件网页，放在库里的导出文件夹（中文「流程图网页」，英文 Outline Flow pages），同名的旧文件直接覆盖。
   * 网页里是和插件同一套画图的代码，所以看起来和笔记里一样；只能看、不能改。
   */
  async exportNote(notePath: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(notePath);
    if (!(file instanceof TFile) || file.extension !== "md") {
      new Notice(t("export.onlyMarkdown"));
      return;
    }
    if (!__OUTLINE_FLOW_VIEWER__) {
      new Notice(t("export.noViewer"));
      return;
    }
    try {
      const charts = collectCharts(await this.app.vault.cachedRead(file), file.basename);
      if (charts.length === 0) {
        new Notice(t("export.noCharts"));
        return;
      }
      const note = await this.loadNote(file.path);
      const { theme, direction, line, structure, snap, height } = this.settings;
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      const payload: ExportPayload = {
        title: file.basename,
        date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
        // 复制一份：网页里折叠备注这类操作不能改到插件正在用的数据
        charts: charts.map((c) => ({ ...c, data: JSON.parse(JSON.stringify(note.diagrams[c.id] ?? { pos: {} })) })),
        settings: { theme, direction, line, structure, snap, height },
        lang: getLang(),
      };
      const html = buildExportHtml(payload, __OUTLINE_FLOW_VIEWER__);
      const folder = exportFolder();
      const out = normalizePath(`${folder}/${file.basename}.html`);
      await this.ensureFolder(folder);
      await this.app.vault.adapter.write(out, html);
      new Notice(t("export.done", { path: out }));
      try {
        (this.app as any).showInFolder?.(out);
      } catch {
        // 打不开文件夹不要紧，文件已经写好了
      }
    } catch (e) {
      console.error("[outline-flow] export failed", notePath, e);
      new Notice(t("export.failed", { folder: exportFolder() }));
    }
  }

  async openSide() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(SIDE_VIEW)[0];
    if (!leaf) {
      const right = workspace.getRightLeaf(false);
      if (!right) return;
      leaf = right;
      await leaf.setViewState({ type: SIDE_VIEW, active: true });
    }
    await workspace.revealLeaf(leaf);
  }

  /** 「新图跟上一张一样」时：在图上换了主题或结构，就把它当成新图的默认 */
  rememberStyle(style: { theme?: string; structure?: Structure }) {
    if (this.settings.newStyle !== "last") return;
    if (style.theme) this.settings.theme = style.theme;
    if (style.structure) this.settings.structure = style.structure;
    void this.saveSettings();
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  // ---------- 位置文件：<文件夹>/<笔记路径>.json，一篇笔记一个 ----------

  dataPath(notePath: string, folder = this.settings.folder): string {
    return normalizePath(`${folder}/${notePath.replace(/\.md$/i, "")}.json`);
  }

  loadNote(notePath: string): Promise<NoteData> {
    const cached = this.cache.get(notePath);
    if (cached) return Promise.resolve(cached);
    let pending = this.loading.get(notePath);
    if (!pending) {
      pending = this.readNote(notePath).finally(() => this.loading.delete(notePath));
      this.loading.set(notePath, pending);
    }
    return pending;
  }

  private async readNote(notePath: string): Promise<NoteData> {
    let data: NoteData = { version: 1, diagrams: {} };
    const path = this.dataPath(notePath);
    try {
      if (await this.app.vault.adapter.exists(path)) {
        const parsed = JSON.parse(await this.app.vault.adapter.read(path));
        if (parsed && parsed.version === 1 && parsed.diagrams && typeof parsed.diagrams === "object") data = parsed;
      }
    } catch (e) {
      console.error("[outline-flow] failed to read positions file", path, e);
    }
    this.cache.set(notePath, data);
    return data;
  }

  /** 同一篇笔记的写入排队，免得两张图同时保存互相覆盖 */
  saveNote(notePath: string): Promise<void> {
    const prev = this.writing.get(notePath) ?? Promise.resolve();
    const next = prev.then(async () => {
      const data = this.cache.get(notePath);
      if (!data) return;
      const path = this.dataPath(notePath);
      await this.ensureFolder(path.split("/").slice(0, -1).join("/"));
      await this.app.vault.adapter.write(path, JSON.stringify(data, null, 2));
    });
    const guarded = next.catch((e) => {
      console.error("[outline-flow] failed to write positions file", notePath, e);
      new Notice(t("save.failed", { folder: this.settings.folder }));
    });
    this.writing.set(notePath, guarded);
    return guarded;
  }

  private async ensureFolder(folder: string) {
    if (!folder) return;
    const parts = folder.split("/");
    let cur = "";
    for (const part of parts) {
      cur = cur ? `${cur}/${part}` : part;
      if (!(await this.app.vault.adapter.exists(cur))) await this.app.vault.adapter.mkdir(cur);
    }
  }

  /** 笔记改名或移动时，位置文件跟着走 */
  private async onRename(file: TAbstractFile, oldPath: string) {
    if (!(file instanceof TFile) || file.extension !== "md") return;
    const from = this.dataPath(oldPath);
    const to = this.dataPath(file.path);
    const cached = this.cache.get(oldPath);
    if (cached) {
      this.cache.delete(oldPath);
      this.cache.set(file.path, cached);
    }
    try {
      await (this.writing.get(oldPath) ?? Promise.resolve());
      if (!(await this.app.vault.adapter.exists(from))) return;
      if (await this.app.vault.adapter.exists(to)) return; // 目标已有文件，不覆盖
      await this.ensureFolder(to.split("/").slice(0, -1).join("/"));
      await this.app.vault.adapter.rename(from, to);
    } catch (e) {
      console.error("[outline-flow] positions file did not follow the note rename", from, to, e);
    }
  }

  /** 改了存放文件夹：把旧文件夹整体搬到新名字下 */
  async moveFolder(oldFolder: string, newFolder: string): Promise<boolean> {
    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(oldFolder))) return true;
    if (await adapter.exists(newFolder)) return false;
    await this.ensureFolder(newFolder.split("/").slice(0, -1).join("/"));
    await adapter.rename(oldFolder, newFolder);
    return true;
  }

  // ---------- 渲染 ----------

  private async render(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) {
    const index = await this.blockIndex(el, ctx);
    const notePath = index === null ? null : ctx.sourcePath;
    const note = notePath ? await this.loadNote(notePath) : null;
    ctx.addChild(new FlowView(el, this, source, notePath, index === null ? "0" : String(index), note));
  }

  /** 这是笔记里的第几张图。拿不到位置信息时返回 null，这张图就不记位置。 */
  private async blockIndex(el: HTMLElement, ctx: MarkdownPostProcessorContext): Promise<number | null> {
    let info = ctx.getSectionInfo(el);
    if (!info) {
      await new Promise((r) => window.setTimeout(r, 50));
      info = ctx.getSectionInfo(el);
    }
    if (!info) return null;
    const lineStart = info.lineStart;
    return findFlowBlocks(info.text).filter((b) => b.start < lineStart).length;
  }
}

/** 字体列表里只要有一个绘图库不认的名字（中文名、符号），整条就作废；这里只留字母数字的名字，末尾补通用字体 */
function safeFontFamily(css: string): string {
  const names = (css || "")
    .split(",")
    .map((n) => n.trim())
    .filter((n) => /^"?-?[A-Za-z][A-Za-z0-9 _-]*"?$/.test(n) && !/^(sans-serif|serif|monospace)$/i.test(n));
  return [...names, '"PingFang SC"', "sans-serif"].join(", ");
}

/** 正在图上输入文字：改一个现有节点，或者给某个节点加同级 / 下级（那时 node 是还没写进笔记的临时节点） */
interface EditState {
  mode: "setText" | "addSibling" | "addChild";
  node: any;
  /** 加节点时，从哪个节点加出来的 */
  anchor: any | null;
  input: HTMLInputElement;
  /** 改字时编辑框里原来的字 */
  raw: string;
  /** 改字时节点原来显示的字，取消时还原 */
  label: string;
  /** 加节点时：加之前的源文本（取消就按它重画）和锚点在里面的行号（写笔记时用） */
  origSource?: string;
  anchorLine?: number;
}

export class FlowView extends MarkdownRenderChild {
  private cy: any = null;
  private observer: ResizeObserver | null = null;
  private fitted = false;
  /** 你自己挪过或缩放过画面之后，窗口变大变小就不再自动摆正 */
  private userMoved = false;
  private saveTimer: number | null = null;
  private stage!: HTMLElement;
  private status!: HTMLElement;
  /** 盖在画布上的提示（还没写内容 / 解析出错） */
  private overlay!: HTMLElement;
  /** 重新打开时要接回来的缩放和位置 */
  private wanted: Viewport | null = null;
  private resetBtn: HTMLButtonElement | null = null;
  private fullBtn: HTMLButtonElement | null = null;
  /** 点开多个网址的节点时弹出的小菜单；没开着就是 null */
  private linkMenu: HTMLElement | null = null;
  /** 鼠标移到带网址的节点上时，图左下角显示地址的小条 */
  private linkTip!: HTMLElement;
  private themePicker: Picker | null = null;
  private dirSel: HTMLSelectElement | null = null;
  private lineSel: HTMLSelectElement | null = null;
  private structurePicker: Picker | null = null;
  private notesBtn: HTMLButtonElement | null = null;
  private nearBtn: HTMLButtonElement | null = null;
  /** 当前选中的节点。只有能在图上改的节点才会被选中 */
  private selected: any = null;
  private editing: EditState | null = null;
  /** 图下面的按键提示行 */
  private keys: HTMLElement | null = null;
  private toastEl!: HTMLElement;
  private toastTimer: number | null = null;
  /** 导出网页里图右下角的操作提示 */
  private hintEl: HTMLElement | null = null;
  /** 刚发出去一次改笔记的请求，在等图重画；这期间按键不再动手，免得按在过时的行号上 */
  private busy = false;
  private guideV: HTMLElement | null = null;
  private guideH: HTMLElement | null = null;
  private snapBtn: HTMLButtonElement | null = null;
  /** 图在用（见 setActive）；按着鼠标的过程中 */
  private active = false;
  private pointerDown = false;
  /** 这张图里成环的内容，摆成正多边形 */
  private rings: Ring[] = [];
  /** 给新节点打字时，停手后整张重排一次的计时器 */
  private relayoutTimer: number | null = null;
  private busyTimer: number | null = null;
  /** 拖动开始时所有节点的位置，松手时拿来记撤回 */
  private dragBefore: Record<string, Point> | null = null;
  private lastWheel: { kind: WheelKind; at: number } | null = null;
  /** 上一次真正拿去算元素的结构。和当前结构不一致时，光重挂样式不够，得整张重排 */
  private usedStructure: Structure = DEFAULT_STRUCTURE;

  constructor(
    el: HTMLElement,
    private plugin: OutlineFlowPlugin,
    private source: string,
    private notePath: string | null,
    private diagramId: string,
    private note: NoteData | null,
    /**
     * fill：撑满所在的面板（侧栏用）；viewport：接着上一次的缩放和位置；
     * readonly：导出的网页用，只能看——没有工具条、节点不能拖、不存位置，标题由 title 给；
     */
    private opts: { fill?: boolean; viewport?: Viewport | null; readonly?: boolean; title?: string } = {},
  ) {
    super(el);
  }

  sameDiagram(other: FlowView): boolean {
    return !!this.notePath && this.notePath === other.notePath && this.diagramId === other.diagramId;
  }

  /** 另一处显示的同一张图改了位置或外观，这里照着数据重摆 */
  syncFromData() {
    if (!this.cy) return;
    this.themePicker?.setValue(this.theme);
    if (this.dirSel) {
      this.dirSel.value = this.direction;
      this.syncDirEnabled();
    }
    if (this.lineSel) this.lineSel.value = this.line;
    this.structurePicker?.setValue(this.structure);
    // 换了结构：格子坐标整套都变了，只重挂样式不够，得照新结构重算元素
    if (this.usedStructure !== this.structure) {
      this.applySource(this.source);
      if (!this.userMoved) this.fit();
      return;
    }
    this.syncNotes();
    this.applyTheme();
    this.layout();
    if (!this.userMoved) this.fit();
  }

  /** 你挪过画面的话，返回当前的缩放和位置，重画时接着用 */
  getViewport(): Viewport | null {
    if (!this.cy || !this.userMoved) return null;
    return { zoom: this.cy.zoom(), pan: { ...this.cy.pan() } };
  }

  private get data(): DiagramData {
    if (!this.note) return (this.local ??= { pos: {} });
    return (this.note.diagrams[this.diagramId] ??= { pos: {} });
  }
  private local: DiagramData | null = null;
  private hasNotes = false;

  private get theme(): string {
    const t = this.data.theme;
    return t && THEMES[t] ? t : this.plugin.settings.theme;
  }
  private get direction(): Direction {
    return this.data.direction ?? this.plugin.settings.direction;
  }
  /** 线型跟着结构走，不再单独选（以前存的 data.line 留着不动，只是不再用） */
  private get line(): LineMode {
    return lineFor(this.structure);
  }
  private get structure(): Structure {
    return liveStructure(this.data.structure ?? this.plugin.settings.structure);
  }
  /**
   * 实际的排布轴。逻辑图听「方向」，别的结构方向是定死的
   * （组织结构图往下、思维导图往右），见 themes.ts 的 axisFor。
   */
  private get axis(): Direction {
    return axisFor(this.structure, this.direction);
  }
  private get showNotes(): boolean {
    return this.data.notes !== false;
  }
  /** 真正的节点（概要节点也算），不算备注小字和大括号的锚点 */
  private mainNodes(): any {
    return this.cy.nodes().not(".note").not(".summary-anchor").not(".temp");
  }
  /** 每把大括号：罩住哪些节点、在哪一侧、是概要还是括号图的分组括号 */
  private summaries: BraceSpec[] = [];
  /** 大纲里写得不对、但还能画的地方（比如 } 前面没有可括的节点），显示在图下面 */
  private warnings: { text: string; find: string }[] = [];
  /** 正在整批摆位置：这期间别每动一个节点就把所有大括号重算一遍 */
  private placing = false;

  onload() {
    const root = this.containerEl;
    root.empty();
    root.addClass("outline-flow");
    // 在实时预览里，点图不应该把光标放进代码块
    root.addEventListener("mousedown", (e) => e.stopPropagation());

    const readonly = !!this.opts.readonly;
    if (readonly) {
      root.addClass("outline-flow-readonly");
      this.buildHeader(root);
    } else this.buildToolbar(root);
    // tabindex：图能拿到焦点，焦点在图上时按键和滚轮才归图管（见 onKey、onWheel）
    this.stage = root.createDiv({ cls: "outline-flow-stage", attr: { tabindex: "0" } });
    if (this.opts.fill) root.addClass("is-fill");
    else this.stage.style.height = (readonly ? EXPORT_MIN_HEIGHT : this.plugin.settings.height) + "px"; // 只读的会在量出图的大小后重设
    if (!readonly) {
      this.status = root.createDiv({ cls: "outline-flow-status" });
      this.keys = root.createDiv({ cls: "outline-flow-keys" });
      this.keys.hide();
    }
    // 「还没写内容」「写错了」的提示盖在画布中间，不去占版面高度
    this.overlay = this.stage.createDiv({ cls: "outline-flow-overlay" });
    this.overlay.hide();
    this.linkTip = this.stage.createDiv({ cls: "outline-flow-linktip" });
    this.linkTip.hide();
    this.toastEl = this.stage.createDiv({ cls: "outline-flow-toast" });
    this.toastEl.hide();
    if (readonly) this.hintEl = this.stage.createDiv({ cls: "outline-flow-hint" });
    this.updateHints();

    // 「图在用」：在这张图的任何地方按下（画布、工具条、弹出的菜单）都算，点到图外面或按 Esc 才退出。
    // 不直接看浏览器的焦点：拖动时 Obsidian 的编辑器会把焦点抢走一下又还回来，跟着焦点走的话边框会闪、滚轮会失灵。
    // 按键还是要焦点：松开时（不在输入框里）把焦点放回画布，点完菜单按钮也能接着按键、滚轮缩放
    const inInput = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.("input");
    root.addEventListener(
      "mousedown",
      (e) => {
        this.pointerDown = true;
        this.setActive(true);
        if (!inInput(e.target) && e.target instanceof Node && this.stage.contains(e.target) && document.activeElement !== this.stage) this.focusStage();
      },
      true,
    );
    this.registerDomEvent(window, "mouseup", (e: MouseEvent) => {
      if (!this.pointerDown) return;
      this.pointerDown = false;
      if (inInput(e.target)) return;
      // 等这一轮事件（按钮的 click、菜单的选择）都处理完再把焦点放回画布
      window.setTimeout(() => {
        if (!this.cy || this.editing || !this.active) return;
        if (document.activeElement !== this.stage) this.focusStage();
      }, 0);
    });
    // 点到图外面：退出
    this.registerDomEvent(document, "mousedown", (e: MouseEvent) => {
      if (this.active && e.target instanceof Node && !root.contains(e.target)) this.setActive(false);
    }, true); // 捕获阶段：别处的元素拦掉冒泡也照样收得到
    // 键盘把焦点挪到图外面（比如按 Tab 走开）也算退出；按着鼠标拖的时候被抢走的不算
    this.registerDomEvent(document, "focusin", (e: FocusEvent) => {
      if (this.active && !this.pointerDown && e.target instanceof Node && !root.contains(e.target)) this.setActive(false);
    });

    // 对齐参考线：拖节点时出现，一竖一横
    this.guideV = this.stage.createDiv({ cls: "outline-flow-guide is-v" });
    this.guideH = this.stage.createDiv({ cls: "outline-flow-guide is-h" });
    this.guideV.hide();
    this.guideH.hide();

    // 画布只建一次。内容变化走 applySource()，不再销毁重建——
    // 每次编辑都重建的话，打字时每一下都在重新分配画布、重绑事件、重算 fit。
    this.cy = cytoscape({
      container: this.stage,
      elements: [],
      minZoom: 0.3,
      maxZoom: 2.5,
      userZoomingEnabled: false, // 滚轮留给笔记滚动；按住 Cmd/Ctrl 再滚才缩放
      boxSelectionEnabled: false,
      autounselectify: true, // 选中状态由我们自己管（selected 类），不用 cytoscape 自带的
    });
    if (readonly) this.cy.autoungrabify(true); // 只能看：节点不能拖
    // 手机、平板上，笔记里代码块的图只用来看：手指按在图上不拖节点、不挪画面，滑动直接翻笔记。
    // 要拖、要改，去侧栏里的图上操作（侧栏的图不受影响）
    if (!readonly && !this.opts.fill && Platform.isMobile) {
      this.cy.autoungrabify(true);
      root.addClass("is-touch-static");
    }

    // 按下节点：记下现在所有位置（拖完要记撤回），并选中它
    this.cy.on("grab", "node", (evt: any) => {
      if (readonly || evt.target.hasClass("temp")) return;
      this.dragBefore = clonePos(this.data.pos);
      this.focusStage();
      this.closeLinkMenu();
      this.select(evt.target);
    });
    this.cy.on("dragfree", "node", (evt: any) => {
      const n = evt.target;
      const before = this.dragBefore;
      this.dragBefore = null;
      const at = this.snapPoint(n);
      this.showGuides(null);
      n.position(at);
      this.data.pos[n.data("key")] = at;
      if (before && this.canEdit && !samePos(before, this.data.pos)) {
        this.plugin.pushHistory(this.viewportKey, { kind: "pos", before, after: clonePos(this.data.pos) });
      }
      this.updateRefs();
      this.updateStatus();
      this.queueSave();
    });
    // 节点一动，它的备注跟着走，引用线的绕法也跟着变；概要花括号也要重新罩住这一组
    this.cy.on("position", "node", (evt: any) => {
      const n = evt.target;
      if (this.placing || n.hasClass("summary-anchor") || n.hasClass("note")) return; // 自己摆出来的，别回环
      this.placeNote(n);
      this.placeSummaries();
    });
    this.cy.on("drag", "node", (evt: any) => {
      this.showGuides(evt.target);
      this.updateRefs();
      this.updateCurves(evt.target.connectedEdges());
    });
    // 点一下备注：收起成「···」；再点一下展开
    this.cy.on("tap", "node.note", (evt: any) => {
      const key = evt.target.data("ownerKey") as string;
      const folded = new Set(this.data.notesFolded ?? []);
      if (folded.has(key)) folded.delete(key);
      else folded.add(key);
      this.data.notesFolded = [...folded];
      this.syncNotes();
      this.layout();
      this.queueSave();
    });

    // 点节点：插件里是选中它，⌘（Windows / Linux 是 Ctrl）+ 点带链接的节点才打开（一个直接打开，几个弹小菜单）；
    // 导出的网页里没有选中这回事，直接点就打开。
    // 拖动节点之后松手不会触发 tap：cytoscape 在松手时检查「这次动过节点、拖过画面、位移超过阈值」，有一样就不发 tap。
    this.cy.on("tap", "node", (evt: any) => {
      const n = evt.target;
      if (n.hasClass("note") || n.hasClass("temp")) return; // 备注自己有点击处理，临时节点只是占位
      this.focusStage();
      if (n.hasClass("link") && (readonly || this.isModClick(evt.originalEvent))) {
        this.openLinks(n);
        return;
      }
      this.closeLinkMenu();
      if (!readonly) this.select(n);
    });
    // 点背景：把菜单收起来、取消选中；图拿到焦点（滚轮、按键从这时起归图管）
    this.cy.on("tap", (evt: any) => {
      if (evt.target !== this.cy) return;
      this.closeLinkMenu();
      this.focusStage();
      this.select(null);
    });
    // 双击节点：改字
    this.cy.on("dbltap", "node", (evt: any) => {
      if (readonly || !this.isEditable(evt.target)) return;
      this.select(evt.target);
      void this.startText(evt.target);
    });
    this.cy.on("viewport", () => {
      this.closeLinkMenu(); // 菜单是按屏幕位置摆的，画面一动就对不上了
      this.positionInput();
    });
    this.cy.on("mouseover", "node.link", (evt: any) => {
      const links: LinkInfo[] = evt.target.data("links") ?? [];
      // 插件里点一下是选中，不是打开，所以指针不变成手形，提示里写明怎么打开
      if (readonly) this.stage.style.cursor = "pointer";
      const shown = links.map((l) => (l.kind === "note" ? t("link.note", { name: l.url }) : l.url)).join("  ·  ");
      this.linkTip.setText(readonly ? shown : t("link.openTip", { mod: isMac() ? "⌘" : "Ctrl", links: shown }));
      this.linkTip.show();
    });
    this.cy.on("mouseout", "node.link", () => this.resetLinkHover());
    this.registerDomEvent(document, "keydown", (e: KeyboardEvent) => {
      if (e.key === "Escape" && this.linkMenu) this.closeLinkMenu();
    });

    this.stage.addEventListener("wheel", (e: WheelEvent) => this.onWheel(e), { passive: false });
    this.registerDomEvent(this.stage, "keydown", (e: KeyboardEvent) => this.onKey(e));
    // 焦点在图上时提示行要变；失去焦点要等浏览器把新焦点定下来再看
    // 键盘走进来（Tab 到画布上）也算开始用
    this.registerDomEvent(this.stage, "focusin", () => this.setActive(true));

    this.cy.on("dragpan pinchzoom", () => {
      this.userMoved = true;
    });

    // 代码块重渲染会换一个新实例，靠这里把上次的缩放和位置接回来
    this.wanted = this.opts.viewport ?? this.plugin.recallViewport(this.viewportKey);

    // 第一次画的图：把这时的默认主题和结构记到它自己身上。以后默认样式变了（比如在别的图上换了主题），
    // 这张图也不会跟着变，只有新打开的图才用新的默认
    if (!readonly && this.notePath && this.note && (!this.data.theme || !this.data.structure)) {
      this.data.theme ??= this.plugin.settings.theme;
      this.data.structure ??= liveStructure(this.plugin.settings.structure);
      this.queueSave();
    }

    this.applySource(this.source);
    this.plugin.track(this);

    // 代码块刚渲染时可能还没有尺寸，等有了尺寸再摆正
    this.observer = new ResizeObserver(() => {
      if (!this.cy || this.stage.clientWidth === 0) return;
      if (readonly && !this.userMoved && !this.isFullscreen()) this.sizeToGraph();
      this.cy.resize();
      if (!this.fitted && this.wanted) {
        this.cy.viewport(this.wanted);
        this.fitted = true;
        this.userMoved = true;
      } else if (!this.fitted || !this.userMoved) this.fit();
    });
    this.observer.observe(this.stage);
  }

  /**
   * 用一份大纲（重新）填充画布。解析失败或内容为空时清空并给出提示。
   * 元素整批换掉，cytoscape 实例和它上面的事件都留着。
   * restyle：要不要重挂样式表。样式只跟主题/方向/线型有关，内容变了不用重挂——
   * 挂一次会把全图元素的样式重算一遍，是这条路径上最贵的一步。
   */
  private applySource(source: string, restyle = true) {
    if (!this.cy) return;
    this.source = source;
    this.usedStructure = this.structure;
    this.closeLinkMenu();
    this.resetLinkHover();
    // 内容换了：正在输入的、选中的、等着重画的，都是对着旧画面的，一律作废
    this.abandonEdit();
    this.selected = null;
    this.setBusy(false);

    let elements: ReturnType<typeof buildElements>;
    try {
      // 导出的网页里没有 Obsidian，[[双链]] 点不开，当普通文字
      elements = buildElements(source, this.structure, { noteLinks: !this.opts.readonly, nearRefs: this.data.nearRefs === true });
    } catch (e: any) {
      this.dropAll();
      this.showOverlay(t("overlay.parseError", { reason: e?.message ?? t("overlay.parseError.default") }), true);
      return;
    }
    if (elements.length === 0) {
      this.dropAll();
      this.showOverlay(t("overlay.empty"), false);
      return;
    }
    this.showOverlay("", false);

    // 大括号和提示单独拿出来，不直接进 cytoscape（cytoscape 只认 nodes/edges）
    const coreElements = elements.filter((e) => e.group === "nodes" || e.group === "edges");
    this.warnings = elements.filter((e) => e.group === "warnings").map((e) => ({ text: String(e.data.text), find: String(e.data.find ?? "") }));

    // 连同旧的备注小字、旧的大括号锚点一起清掉
    this.cy.elements().remove();
    this.hasNotes = elements.some((e) => e.group === "nodes" && e.data.note);
    this.cy.add(coreElements as any);
    assignBranches(this.cy); // 分支配色要知道每个节点属于哪个一级分支、第几层
    if (this.nearBtn) {
      const on = this.data.nearRefs === true;
      this.nearBtn.toggleClass("is-active", on);
      this.nearBtn.setAttr("aria-pressed", String(on));
      if (this.cy.edges(".ref").nonempty() || on) this.nearBtn.show();
      else this.nearBtn.hide();
    }
    // 成环的内容（五行那种）摆成正多边形，见 ring.ts。放射图本身就是一圈圈的，不再套环
    this.rings = this.structure === "radial" ? [] : findRings(this.cy);
    markRings(this.cy, this.rings);

    // 大括号：一条从锚点到锚点的边，鼓成 } 的形状。锚点由 placeSummaries() 摆到被括范围的外沿上。
    this.summaries = bracesFrom(elements);
    addBraces(this.cy, this.summaries);

    this.syncNotes();
    if (restyle) this.applyTheme(); // 样式没变就别重挂，交给 layout 里的 updateRefs
    this.layout();
    this.applyPending(source);
  }

  /** 内容变了就地重画，不销毁 cytoscape 实例，也不重挂样式表 */
  update(source: string) {
    if (!this.cy || source === this.source) return;
    if (this.editing?.origSource === source) return; // 正在给新节点打字：画面是预排的，笔记还没改，别被旧内容冲掉
    this.applySource(source, false);
    // 手动挪过画面的话，视角保持不动；没挪过就重新摆正（和原来重建后 fit 一次的效果一致）
    if (!this.userMoved) this.fit();
  }

  private dropAll() {
    if (!this.cy) return;
    this.abandonEdit();
    this.selected = null;
    this.setBusy(false);
    this.updateHints();
    this.closeLinkMenu();
    this.resetLinkHover();
    this.cy.elements().remove();
    this.summaries = [];
    this.warnings = [];
    this.hasNotes = false;
    this.syncNotes();
    this.updateStatus();
  }

  private showOverlay(text: string, isError: boolean) {
    if (!this.overlay) return;
    this.overlay.setText(text);
    this.overlay.toggleClass("is-error", isError);
    if (text) this.overlay.show();
    else this.overlay.hide();
  }

  private get viewportKey(): string {
    return this.plugin.viewportKey(this.notePath, this.diagramId);
  }

  onunload() {
    this.structurePicker?.close();
    this.themePicker?.close();
    this.plugin.untrack(this);
    this.observer?.disconnect();
    for (const t of [this.busyTimer, this.toastTimer]) if (t !== null) window.clearTimeout(t);
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveNow();
    }
    // 记住视角：代码块重渲染、切走再切回来都靠它，免得图每次都跳回左上角
    this.plugin.rememberViewport(this.viewportKey, this.getViewport());
    this.cy?.destroy();
    this.cy = null;
  }

  /** 导出的网页里的卡片标题条：左边图名，右边两个按钮 */
  private buildHeader(root: HTMLElement) {
    const head = root.createDiv({ cls: "outline-flow-head" });
    head.createDiv({ cls: "outline-flow-title", text: this.opts.title ?? "" });
    head.createEl("button", { text: t("toolbar.fit") }).addEventListener("click", () => this.fit());
    const full = (this.fullBtn = head.createEl("button", { text: t("toolbar.fullscreen") }));
    full.addEventListener("click", () => {
      // 浏览器不让全屏时（权限、嵌在别的页面里）会拒绝，这里吞掉，按钮点了没反应就是了
      if (this.isFullscreen()) document.exitFullscreen().catch(() => {});
      else root.requestFullscreen().catch(() => {});
    });
    // 有的浏览器（比如 iPhone 上的 Safari）不让普通元素全屏，按钮就不要了
    if (!root.requestFullscreen || document.fullscreenEnabled === false) full.hide();
    root.addEventListener("fullscreenchange", () => this.onFullscreenChange());
  }

  private isFullscreen(): boolean {
    return document.fullscreenElement === this.containerEl;
  }

  /** 进出全屏：全屏时图撑满屏幕，退出后按图的比例重新定高；两种情况都要重新量一遍画布再摆正 */
  private onFullscreenChange() {
    const full = this.isFullscreen();
    this.containerEl.toggleClass("is-fill", full);
    this.fullBtn?.setText(full ? t("toolbar.exitFullscreen") : t("toolbar.fullscreen"));
    if (full) this.stage.style.height = "";
    else this.sizeToGraph();
    this.cy?.resize();
    this.fit();
  }

  /**
   * 网页里图的高度：按排好的图的宽高比、在卡片这个宽度下算，夹在 240 像素到屏幕高度的 80% 之间。
   * 缩放的上限和 fit() 一致（1.2 倍），不然只有两三个节点的图会被拉得很高。
   */
  private sizeToGraph() {
    if (!this.cy) return;
    const width = this.stage.clientWidth;
    if (width === 0) return;
    const box = this.cy.elements().boundingBox();
    let want = EXPORT_MIN_HEIGHT;
    if (box.w > 0 && box.h > 0) {
      const scale = Math.min(1.2, (width - 80) / box.w);
      want = box.h * Math.max(scale, 0.05) + 80;
    }
    const max = Math.max(EXPORT_MIN_HEIGHT, window.innerHeight * 0.8);
    const height = Math.round(Math.min(Math.max(want, EXPORT_MIN_HEIGHT), max));
    if (this.stage.style.height !== height + "px") this.stage.style.height = height + "px";
  }

  // ---------- 点节点打开网址 ----------

  /** 这次点击是不是按着 ⌘（Windows / Linux 是 Ctrl）点的 */
  private isModClick(e: MouseEvent | undefined): boolean {
    return !!e && (isMac() ? e.metaKey : e.ctrlKey);
  }

  private openLink(l: LinkInfo) {
    if (l.kind === "note") this.plugin.openNoteLink(l.url, this.notePath ?? "");
    else window.open(l.url, "_blank", "noopener");
  }

  private openLinks(node: any) {
    this.closeLinkMenu();
    const links: LinkInfo[] = node.data("links") ?? [];
    if (links.length === 0) return;
    if (links.length === 1) {
      this.openLink(links[0]);
      return;
    }
    const menu = (this.linkMenu = this.stage.createDiv({ cls: "outline-flow-linkmenu" }));
    // 菜单盖在画布上：按下、抬起都不能传给画布，不然会被当成点了背景（菜单立刻收起、链接点不开）或开始拖画面
    for (const type of ["mousedown", "mouseup", "touchstart", "touchend", "wheel"]) {
      menu.addEventListener(type, (e) => e.stopPropagation(), { passive: true });
    }
    for (const l of links) {
      // 网址是真的链接；双链没有地址，点了走 Obsidian 打开
      const a = menu.createEl("a", l.kind === "url" ? { href: l.url, attr: { target: "_blank", rel: "noopener" } } : {});
      a.createEl("span", { text: l.text });
      if (l.kind === "note") a.createEl("small", { text: t("link.note", { name: l.url }) });
      else if (l.text !== l.url) a.createEl("small", { text: l.url });
      a.addEventListener("click", (e) => {
        if (l.kind === "note") {
          e.preventDefault();
          this.openLink(l);
        }
        this.closeLinkMenu();
      });
    }
    // 摆在节点正下方；放不下就往上翻，左右不超出画布
    const at = node.renderedPosition();
    const half = node.renderedOuterHeight() / 2;
    const gap = 6;
    const left = Math.max(gap, Math.min(at.x - menu.offsetWidth / 2, this.stage.clientWidth - menu.offsetWidth - gap));
    let top = at.y + half + gap;
    if (top + menu.offsetHeight > this.stage.clientHeight - gap) top = Math.max(gap, at.y - half - gap - menu.offsetHeight);
    menu.style.left = left + "px";
    menu.style.top = top + "px";
  }

  private closeLinkMenu() {
    this.linkMenu?.remove();
    this.linkMenu = null;
  }

  private resetLinkHover() {
    if (!this.stage) return;
    this.stage.style.cursor = "";
    this.linkTip?.hide();
  }

  // ---------- 焦点、滚轮、按键 ----------

  /** 能在图上改笔记：不是导出的网页，而且知道这张图属于哪篇笔记 */
  private get canEdit(): boolean {
    return !this.opts.readonly && !!this.notePath;
  }

  private focusStage() {
    this.stage?.focus({ preventScroll: true });
  }

  /** 焦点在图上（含正在输入文字的输入框）：滚轮和按键从这时起归图管 */
  private hasFocus(): boolean {
    return this.active;
  }

  /** 图在不在用：外框加 is-active，边框和提示跟着它，不跟着浏览器的焦点闪 */
  private setActive(on: boolean) {
    if (this.active === on) return;
    this.active = on;
    this.containerEl.toggleClass("is-active", on);
    if (!on && this.stage && this.stage.contains(document.activeElement)) (document.activeElement as HTMLElement).blur?.();
    this.updateHints();
  }

  /**
   * 滚轮。图没有焦点时和以前一样（普通滚轮让笔记滚，⌘/Ctrl+滚轮缩放）；
   * 有焦点时：鼠标滚轮缩放、触控板双指滑动平移、捏合缩放、Shift+滚轮横向平移。怎么区分见 wheel.ts。
   */
  private onWheel(e: WheelEvent) {
    if (!this.cy) return;
    const now = performance.now();
    const prev = this.lastWheel ? { kind: this.lastWheel.kind, dt: now - this.lastWheel.at } : null;
    this.lastWheel = { kind: wheelKind(e, prev), at: now };
    const act = wheelAction(e, this.hasFocus(), prev);
    if (act.type === "none") return;
    e.preventDefault();
    this.userMoved = true;
    if (act.type === "pan") {
      this.cy.panBy({ x: -act.dx, y: -act.dy });
      return;
    }
    const rect = this.stage.getBoundingClientRect();
    const level = Math.min(2.5, Math.max(0.3, this.cy.zoom() * Math.pow(1 + act.rate, -act.delta)));
    this.cy.zoom({ level, renderedPosition: { x: e.clientX - rect.left, y: e.clientY - rect.top } });
  }

  /** 图下面的按键提示行，和导出网页里图右下角的操作提示：按有没有选中、有没有焦点、是不是在输入来换 */
  private updateHints() {
    if (!this.stage) return;
    const mac = isMac();
    const focused = this.hasFocus();
    const mod = mac ? "⌘" : "Ctrl";
    this.hintEl?.setText(focused ? t("hint.pan.focused") : t("hint.pan.idle", { mod }));
    if (!this.keys) return;
    const parts: string[] = [];
    if (this.editing) parts.push(t("hint.editing"));
    else {
      if (this.selected) {
        parts.push(t("hint.selected", { undo: mac ? "⌘Z" : "Ctrl+Z", mod }));
      }
      if (focused) parts.push(t("hint.zoom"));
    }
    this.keys.setText(parts.join(" · "));
    if (parts.length) this.keys.show();
    else this.keys.hide();
  }

  /** 图里的小提示（已撤回、已经是最上面一级了……），过一会儿自己消失 */
  private toast(msg: string) {
    if (!this.toastEl) return;
    this.toastEl.setText(msg);
    this.toastEl.show();
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toastTimer = null;
      this.toastEl.hide();
    }, 1400);
  }

  /** 在等图重画：这期间按键不再动手。重画一直没来，过一会儿自己放开，并收掉还没换掉的临时节点 */
  private setBusy(on: boolean) {
    this.busy = on;
    if (this.busyTimer !== null) {
      window.clearTimeout(this.busyTimer);
      this.busyTimer = null;
    }
    if (on) {
      this.busyTimer = window.setTimeout(() => {
        this.busyTimer = null;
        this.busy = false;
        this.dropTemp();
      }, 1500);
    }
  }

  private onKey(e: KeyboardEvent) {
    // 只管焦点正好在图上的按键（输入框里的按键它自己处理，不会冒到这里）
    if (!this.cy || e.target !== this.stage || e.isComposing) return;
    const handled = () => {
      e.preventDefault();
      e.stopPropagation(); // 别传给编辑器和 Obsidian 的快捷键
    };
    const k = e.key;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && !e.altKey && k === "0") {
      handled();
      this.fit();
      return;
    }
    if (this.opts.readonly) {
      if (k === "Escape") {
        handled();
        this.setActive(false);
      }
      return;
    }
    if (!this.canEdit) return;
    if (mod && !e.altKey) {
      const z = k.toLowerCase();
      if (z === "z") {
        handled();
        void this.undoRedo(e.shiftKey);
      } else if (z === "y" && e.ctrlKey && !e.shiftKey) {
        handled();
        void this.undoRedo(true);
      }
      return; // 别的组合键（复制、粘贴……）不抢
    }
    if (mod || e.altKey) return;

    const sel = this.selected && !this.selected.removed() ? this.selected : null;
    switch (k) {
      case "Escape":
        handled();
        if (sel) this.select(null);
        else this.setActive(false);
        return;
      case "ArrowLeft":
      case "ArrowRight":
      case "ArrowUp":
      case "ArrowDown":
        handled();
        this.arrow(k);
        return;
      case "Enter":
      case "Tab":
      case " ":
      case "F2":
      case "Delete":
      case "Backspace": {
        if (!sel) return; // 没选中节点就不管，Tab 照常把焦点移走
        handled();
        if (e.repeat || this.busy || this.editing) return;
        if (k === "Enter") this.startAdd("addSibling");
        else if (k === "Tab" && e.shiftKey) void this.write({ kind: "promote", line: sel.data("line") });
        else if (k === "Tab") this.startAdd("addChild");
        else if (k === " " || k === "F2") void this.startText(sel);
        else void this.write({ kind: "remove", line: sel.data("line") });
        return;
      }
    }
  }

  // ---------- 选中 ----------

  /** 能不能在图上改这个节点：备注、概要、临时节点、只写了一个 (引用) 的行都不行 */
  private isEditable(n: any): boolean {
    if (!this.canEdit || !n || n.removed()) return false;
    if (n.is(".note, .summary-node, .summary-anchor, .temp, .ghost")) return false;
    const line = n.data("line") as number;
    return line > 0 && lineIsNode(this.source.split("\n")[line - 1] ?? "");
  }

  /** 选中一个节点（不能改的节点按没选处理）；传 null 是取消选中 */
  private select(n: any | null) {
    if (n && !this.isEditable(n)) n = null;
    if (this.selected === n) return;
    this.selected?.removeClass("selected");
    this.selected = n;
    n?.addClass("selected");
    this.updateHints();
  }

  /** 节点在画面外就把画面挪过去一点，免得按方向键选到了却看不见 */
  private reveal(n: any) {
    const bb = n.renderedBoundingBox();
    const m = 24;
    const w = this.stage.clientWidth;
    const h = this.stage.clientHeight;
    let dx = 0;
    let dy = 0;
    if (bb.x1 < m) dx = m - bb.x1;
    else if (bb.x2 > w - m) dx = w - m - bb.x2;
    if (bb.y1 < m) dy = m - bb.y1;
    else if (bb.y2 > h - m) dy = h - m - bb.y2;
    if (dx || dy) {
      this.cy.panBy({ x: dx, y: dy });
      this.userMoved = true;
    }
  }

  /**
   * 方向键在节点之间走，按树走：上一级、第一个子节点、前一个同级、后一个同级。
   * 左右上下对应哪个，看排布轴：往右排的图左是上一级、右是第一个子节点，上下是同级；往下排的图上下是层级，左右是同级；
   * 思维导图左半边的节点反过来（往左是子节点）。
   */
  private arrow(k: string) {
    const nodes: any[] = this.mainNodes().filter((n: any) => this.isEditable(n)).toArray();
    if (nodes.length === 0) return;
    const sel = this.selected && !this.selected.removed() ? this.selected : null;
    let next: any = null;
    if (!sel) next = nodes.reduce((a, b) => (b.data("line") < a.data("line") ? b : a));
    else {
      const links = sourceTree(this.source, nodes.map((n) => n.data("line"))).get(sel.data("line"));
      if (!links) return;
      let to: "parent" | "first" | "prev" | "next";
      if (this.axis === "TB") to = k === "ArrowUp" ? "parent" : k === "ArrowDown" ? "first" : k === "ArrowLeft" ? "prev" : "next";
      else {
        const flip = (sel.data("col") ?? 0) < 0;
        to = k === "ArrowUp" ? "prev" : k === "ArrowDown" ? "next" : k === "ArrowLeft" ? (flip ? "first" : "parent") : flip ? "parent" : "first";
      }
      const line = links[to];
      if (line !== null) next = nodes.find((n) => n.data("line") === line) ?? null;
    }
    if (!next) return;
    this.select(next);
    this.reveal(next);
  }

  // ---------- 在图上输入文字 ----------

  /** 加节点时临时节点里先放的字：撑出一个够输入的宽度，输入时按打的字改 */
  private static get NEW_LABEL(): string {
    return t("input.newLabel");
  }

  /**
   * 给选中的节点加一个同级或下级。先不写笔记：用和真正写进去一样的规则，算出加了一行以后的大纲，
   * 整张图按它重新排一遍。新节点直接出现在它最终的位置、线也连好了，旁边的节点让开；输入框盖在它上面。
   * 确定了才写进笔记，取消就按原来的大纲排回去。
   */
  private async startAdd(kind: "addSibling" | "addChild") {
    const anchor = this.selected;
    if (!anchor || anchor.removed() || this.editing || this.busy || !this.notePath) return;
    const orig = this.source;
    const anchorLine = anchor.data("line") as number;
    this.setBusy(true);
    const r = await this.plugin.previewEdit({ notePath: this.notePath, diagramId: this.diagramId, source: orig, op: { kind, line: anchorLine, text: FlowView.NEW_LABEL } });
    if (!this.cy || this.source !== orig) return; // 等的这一会儿图已经换了
    this.setBusy(false);
    if (!r.ok) {
      this.toast(r.reason);
      return;
    }
    this.applySource(r.source, false);
    const node = this.mainNodes().filter((n: any) => n.data("line") === r.srcLine).first();
    if (node.empty()) {
      this.applySource(orig, false);
      this.reselect(anchorLine);
      return;
    }
    node.addClass("fresh");
    this.reveal(node);
    this.openInput({ mode: kind, node, anchor: null, raw: "", label: "", origSource: orig, anchorLine });
  }

  /** 按源文本里的行号重新选中一个节点 */
  private reselect(line: number | undefined) {
    if (line === undefined) return;
    const n = this.mainNodes().filter((x: any) => x.data("line") === line).first();
    if (n.nonempty()) this.select(n);
  }

  /** 改一个现有节点的字：编辑框里放笔记里的原文（不含线上的字和【备注】） */
  private async startText(node: any) {
    if (this.editing || !this.isEditable(node) || !this.notePath) return;
    const raw = await this.plugin.nodeText({ notePath: this.notePath, diagramId: this.diagramId, source: this.source, line: node.data("line") });
    if (!this.cy || this.editing || node.removed()) return;
    if (raw === null) {
      this.toast(t("toast.lineMismatch"));
      return;
    }
    const label = node.data("label");
    node.data("label", raw || FlowView.NEW_LABEL); // 节点按原文的长度撑开，输入框正好盖在上面
    this.openInput({ mode: "setText", node, anchor: null, raw, label });
  }

  /** 在节点上盖一个输入框：位置、字号跟着画面的缩放走 */
  private openInput(st: Omit<EditState, "input">) {
    const input = this.stage.createEl("input", { cls: "outline-flow-input", attr: { type: "text", spellcheck: "false", placeholder: t("input.placeholder") } });
    input.value = st.raw;
    // 输入框盖在画布上：按下、抬起不能传给画布，不然会被当成点了背景或开始拖画面
    for (const type of ["mousedown", "mouseup", "touchstart", "touchend", "dblclick", "click"]) {
      input.addEventListener(type, (e) => e.stopPropagation());
    }
    input.addEventListener("keydown", (e) => {
      e.stopPropagation(); // 输入时的按键只归输入框，别传给编辑器和 Obsidian 的快捷键
      if (e.isComposing || e.keyCode === 229) return; // 输入法选字中
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        this.commit(true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.cancelEdit();
      }
    });
    input.addEventListener("input", () => {
      const cur = this.editing;
      if (!cur) return;
      cur.node.data("label", input.value.trim() || FlowView.NEW_LABEL); // 节点跟着字数变宽
      this.positionInput();
      // 节点变宽了，旁边的节点要让开：停手一小会儿再整张重排一次（每个字都排太费）
      if (this.relayoutTimer !== null) window.clearTimeout(this.relayoutTimer);
      this.relayoutTimer = window.setTimeout(() => {
        this.relayoutTimer = null;
        if (!this.cy || this.editing !== cur) return;
        this.layout();
        this.positionInput();
      }, 150);
    });
    input.addEventListener("blur", () => {
      if (this.editing?.input === input) this.commit(false);
    });
    st.node.addClass("editing");
    this.editing = { ...st, input };
    this.positionInput();
    input.focus();
    input.select();
    this.updateHints();
  }

  /** 输入框正好盖在节点上：位置、大小、字号都按节点现在画出来的样子 */
  private positionInput() {
    const st = this.editing;
    if (!st || !this.cy) return;
    const n = st.node;
    const z = this.cy.zoom();
    const p = n.renderedPosition();
    const w = n.renderedOuterWidth();
    const h = n.renderedOuterHeight();
    const s = st.input.style;
    s.left = p.x - w / 2 + "px";
    s.top = p.y - h / 2 + "px";
    s.width = w + "px";
    s.height = h + "px";
    s.fontSize = parseFloat(n.style("font-size")) * z + "px";
    s.fontFamily = n.style("font-family");
    s.fontWeight = n.style("font-weight");
    s.color = n.style("color");
    s.padding = `0 ${parseFloat(n.style("padding")) * z}px`;
  }

  /** 收掉输入框，返回正在输入的那一份状态；节点上的「正在输入」标记也去掉 */
  private closeEdit(): EditState | null {
    const st = this.editing;
    if (!st) return null;
    this.editing = null; // 先清掉：输入框被摘掉时的 blur 不该再提交一次
    st.input.remove();
    st.node.removeClass("editing");
    this.updateHints();
    return st;
  }

  /** 放弃输入：改字的还原原来的字，加节点的拿掉临时节点。不碰焦点 */
  private abandonEdit() {
    const st = this.closeEdit();
    if (!st) return;
    if (st.mode === "setText") st.node.data("label", st.label);
    else if (st.origSource !== undefined && this.cy) {
      this.applySource(st.origSource, false);
      this.reselect(st.anchorLine);
    }
  }

  private cancelEdit() {
    this.abandonEdit();
    this.focusStage();
  }

  private dropTemp() {
    this.cy?.$(".temp").remove();
  }

  /**
   * 提交输入。refocus：是按回车提交的（输入框没了，焦点要回到图上，接着按键）；
   * 是点了别处失去焦点而提交的就不抢焦点。
   * 空字：新节点当作取消、什么都不写；现有节点不改。字没变也不写。
   */
  private commit(refocus: boolean) {
    const st = this.closeEdit();
    if (!st) return;
    const value = st.input.value.trim();
    if (refocus) this.focusStage();
    if (st.mode === "setText") {
      st.node.data("label", st.label);
      if (!value || value === st.raw) return;
      void this.write({ kind: "setText", line: st.node.data("line"), text: value });
      return;
    }
    if (!value) {
      // 什么都没写：当作取消，按原来的大纲排回去
      if (st.origSource !== undefined) {
        this.applySource(st.origSource, false);
        this.reselect(st.anchorLine);
        if (refocus) this.focusStage();
      }
      return;
    }
    st.node.data("label", value); // 笔记改完、图重画之前，新节点先显示打的字
    st.node.removeClass("fresh");
    void this.write({ kind: st.mode, line: st.anchorLine!, text: value }, st.origSource);
  }

  /** 把一个操作交给插件写进笔记。成功后图会重画（代码块换新的 FlowView，侧栏就地更新），选中和提示在重画时补上 */
  private async write(op: EditOp, source = this.source) {
    if (!this.notePath) return;
    this.setBusy(true);
    const res = await this.plugin.editNode({ notePath: this.notePath, diagramId: this.diagramId, source, op });
    if (!this.cy) return; // 代码块已经重画成新的了
    if (!res.ok) {
      this.setBusy(false);
      if (source !== this.source) this.applySource(source, false); // 加节点没写成：排回原来的样子
      this.toast(res.reason);
    }
  }

  /** 改完笔记、图重画出来之后：选中改的那个节点，弹提示，焦点回到图上，接着按键 */
  private applyPending(source: string) {
    if (!this.canEdit) return;
    const p = this.plugin.takePending(this.notePath, this.diagramId, source);
    if (!p) return;
    if (p.srcLine !== null) {
      const n = this.mainNodes().filter((x: any) => x.data("line") === p.srcLine).first();
      if (n.nonempty()) {
        this.select(n);
        this.reveal(n);
      }
    }
    if (p.toast) this.toast(p.toast);
    this.focusStage();
    // 重画时 Obsidian 可能把焦点抢回编辑器，稍后再要一次
    window.setTimeout(() => {
      if (this.cy && this.selected) this.focusStage();
    }, 60);
  }

  // ---------- 撤回、重做 ----------

  private async undoRedo(redo: boolean) {
    if (!this.canEdit || this.busy || this.editing) return;
    const h = this.plugin.history(this.viewportKey);
    const from = redo ? h.redo : h.undo;
    const to = redo ? h.undo : h.redo;
    const e = from.pop();
    if (!e) {
      this.toast(redo ? t("toast.nothingToRedo") : t("toast.nothingToUndo"));
      return;
    }
    if (e.kind === "pos") {
      this.restorePos(redo ? e.after : e.before);
      to.push(e);
      this.toast(redo ? t("toast.redone") : t("toast.undone"));
      return;
    }
    this.setBusy(true);
    const ok = await this.plugin.rewriteText(this.notePath!, this.diagramId, e, redo ? "redo" : "undo");
    if (ok) to.push(e); // 没做成的这一步就丢掉（笔记在别处改过了，再试也不会成）
    if (this.cy && !ok) this.setBusy(false);
    // 做成了：图重画时 applyPending 会选中节点、弹「已撤回」
  }

  /** 位置换回某一份（撤回、重做拖动或「重新自动排版」） */
  private restorePos(pos: Record<string, Point>) {
    this.data.pos = clonePos(pos);
    this.layout();
    this.queueSave();
  }

  private buildToolbar(root: HTMLElement) {
    const bar = root.createDiv({ cls: "outline-flow-bar" });

    // 结构、主题用自己的弹出菜单（见 picker.ts）：列表整张展开在按钮下面，主题按「分支配色 / 单色」分组
    this.structurePicker = new Picker(bar, root, {
      aria: t("toolbar.structure"),
      groups: [{ items: structureOptions() }],
      value: this.structure,
      onChange: (v) => {
        this.data.structure = v as Structure;
        this.plugin.rememberStyle({ structure: v as Structure });
        this.data.pos = {}; // 换结构等于整套重排，拖过的位置没有意义了
        this.plugin.dropPosHistory(this.viewportKey); // 撤回栈里记的旧位置也跟着没有意义
        this.syncDirEnabled();
        this.applySource(this.source); // 元素的 col/row 都变了，得重新解析重排
        this.fit();
        this.queueSave();
      },
    });

    this.themePicker = new Picker(bar, root, {
      aria: t("toolbar.theme"),
      groups: themeGroups(),
      value: this.theme,
      onChange: (v) => {
        this.data.theme = v;
        this.plugin.rememberStyle({ theme: v });
        this.applyTheme();
        this.queueSave();
      },
    });

    // 方向、线型不再单独选：每种结构用调好的那一套（见 themes.ts 的 axisFor、lineFor）
    bar.createDiv({ cls: "outline-flow-spacer" });

    // 备注开关一直建出来，没有备注时隐藏。内容变了以后不用再补按钮。
    const notesBtn = (this.notesBtn = bar.createEl("button"));
    notesBtn.addEventListener("click", () => {
      this.data.notes = !this.showNotes;
      this.syncNotes();
      this.layout();
      this.queueSave();
    });

    // 关联的靠近排：只有图里有虚线（引用）时才出现
    const nearBtn = (this.nearBtn = bar.createEl("button", { text: t("toolbar.nearRefs"), attr: { "aria-pressed": "false" } }));
    nearBtn.setAttr("title", t("toolbar.nearRefs.tip"));
    nearBtn.addEventListener("click", () => {
      this.data.nearRefs = !this.data.nearRefs;
      this.data.pos = {}; // 顺序变了，拖过的位置对不上了
      this.plugin.dropPosHistory(this.viewportKey);
      this.applySource(this.source);
      this.fit();
      this.queueSave();
    });

    // 吸附开关：所有图共用一个设置
    const snapBtn = (this.snapBtn = bar.createEl("button", { text: t("toolbar.snap") }));
    snapBtn.setAttr("title", t("toolbar.snap.tip"));
    const syncSnap = () => {
      snapBtn.toggleClass("is-active", !!this.plugin.settings.snap);
      snapBtn.setAttr("aria-pressed", String(!!this.plugin.settings.snap));
    };
    syncSnap();
    snapBtn.addEventListener("click", () => {
      this.plugin.settings.snap = !this.plugin.settings.snap;
      syncSnap();
      void this.plugin.saveSettings();
    });

    this.resetBtn = bar.createEl("button", { text: t("toolbar.relayout") });
    this.resetBtn.addEventListener("click", () => {
      const before = clonePos(this.data.pos);
      if (this.canEdit && Object.keys(before).length) this.plugin.pushHistory(this.viewportKey, { kind: "pos", before, after: {} });
      this.data.pos = {};
      this.layout();
      this.fit();
      this.queueSave();
    });

    const copyBtn = bar.createEl("button", { text: t("toolbar.copyFlowchartFun") });
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(toFlowchartFun(this.source));
        new Notice(t("copy.ok"));
      } catch {
        new Notice(t("copy.fail"));
      }
    });

    const path = this.notePath;
    if (path) {
      bar.createEl("button", { text: t("toolbar.exportPage") }).addEventListener("click", () => void this.plugin.exportNote(path));
    }
  }

  private applyTheme() {
    if (!this.cy) return;
    const font = safeFontFamily(getComputedStyle(document.body).fontFamily);
    this.stage.style.background = THEMES[this.theme].stage;
    this.cy.style(styleFor(this.theme, this.axis, font, this.line, this.structure));
    this.updateRefs();
    this.updateCurves();
  }

  /** 结构和方向一起决定排布轴：非逻辑图的方向是定死的，下拉置灰免得你以为没生效 */
  private syncDirEnabled() {
    if (!this.dirSel) return;
    const fixed = !followsDirection(this.structure);
    this.dirSel.disabled = fixed;
    this.dirSel.setAttr("title", fixed ? t("toolbar.dirFixed", { structure: structureName(this.structure) }) : "");
  }

  /** 按开关把备注小字加上或拿掉 */
  private syncNotes() {
    if (this.notesBtn) {
      this.notesBtn.setText(this.showNotes ? t("toolbar.hideNotes") : t("toolbar.showNotes"));
      if (this.hasNotes) this.notesBtn.show();
      else this.notesBtn.hide();
    }
    if (!this.cy) return;
    this.cy.nodes(".note").remove();
    if (!this.showNotes) return;
    const folded = new Set(this.data.notesFolded ?? []);
    this.mainNodes().forEach((n: any) => {
      const text = n.data("note");
      if (!text) return;
      const key = n.data("key") as string;
      const isFolded = folded.has(key);
      this.cy.add({
        group: "nodes",
        data: { id: n.id() + "::note", label: isFolded ? "···" : text, ownerKey: key },
        classes: isFolded ? "note folded" : "note",
        grabbable: false,
        selectable: false,
      });
    });
  }

  /** 备注一律放在节点正下方、居中 */
  private placeNote(owner: any) {
    const note = this.cy.getElementById(owner.id() + "::note");
    if (note.empty()) return;
    const p = owner.position();
    note.position({ x: p.x, y: p.y + owner.outerHeight() / 2 + note.outerHeight() / 2 + 2 });
  }

  /** 弧线模式下把连线弯成 S 形（见 curve.ts）。时间轴、鱼骨图、发散图的线有自己的画法，不动 */
  private updateCurves(only?: any) {
    if (!this.cy) return;
    if (this.structure === "fishbone") routeFish(this.cy);
    const special = this.structure === "timeline" || this.structure === "fishbone" || this.structure === "radial";
    applyCurves(this.cy, this.axis, this.line === "curve" && !special, only);
    // 要在 applyCurves 后面：它关弧线时会把控制点清掉
    if (this.structure === "radial") routeRadial(this.cy, this.line);
  }

  /**
   * 折线模式下给引用线定绕法。两头在同一排或同一列时：
   * 紧挨着、中间又没有别的线，就直接连；否则从外侧绕一个方框，免得压在中间的节点和线上。
   * 判断「够不够地方绕」按两个节点自己的尺寸量，不看格距——格距现在是按内容算的。
   */
  private updateRefs() {
    if (!this.cy) return;
    const poly = this.line === "poly";
    /** 绕出去多远：正好落在两排（两列）之间的空档里 */
    const CLEAR = 22;
    this.cy.edges(".ref").not(".ring").forEach((e: any) => {
      const a = e.source();
      const b = e.target();
      const pa = a.position();
      const pb = b.position();
      const dx = Math.abs(pb.x - pa.x);
      const dy = Math.abs(pb.y - pa.y);
      const sameRow = dy < GRID / 2;
      const sameCol = dx < GRID / 2;
      let around = false;
      if (poly && (sameRow || sameCol) && a.id() !== b.id()) {
        const gap = sameRow ? dx : dy;
        // 两头之间至少空得下一整个节点加两边的绕行余量，才值得绕；否则直接连更短
        const need = sameRow
          ? (a.outerWidth() + b.outerWidth()) / 2 + CLEAR * 2
          : (a.outerHeight() + b.outerHeight()) / 2 + CLEAR * 2;
        const shared = a.edgesWith(b).not(".ref").nonempty();
        around = gap > need || shared;
      }
      if (around) {
        // 往图的外侧绕：两头都从节点朝外的那条边出发，垂直走出去，再拉一条平直的线
        const box = this.mainNodes().boundingBox();
        const out = sameRow
          ? { x: 0, y: (box.y1 + box.y2) / 2 >= pa.y ? -1 : 1 }
          : { x: (box.x1 + box.x2) / 2 >= pa.x ? -1 : 1, y: 0 };
        const sign = Math.sign((pb.x - pa.x) * out.y - (pb.y - pa.y) * out.x) || 1;
        const reach = (n: any) => (sameRow ? n.outerHeight() : n.outerWidth()) / 2 + CLEAR;
        const end = sameRow ? `0 ${out.y < 0 ? "-50%" : "50%"}` : `${out.x < 0 ? "-50%" : "50%"} 0`;
        e.addClass("ref-u");
        e.style({
          "segment-distances": `${sign * reach(a)} ${sign * reach(b)}`,
          "source-endpoint": end,
          "target-endpoint": end,
        });
      } else {
        e.removeClass("ref-u");
        e.removeStyle("segment-distances source-endpoint target-endpoint");
      }
    });
  }

  /** 把每把大括号摆到它罩住的那组节点（连同各自的子树）外沿上，见 brace.ts */
  private placeSummaries() {
    if (!this.cy || this.summaries.length === 0) return;
    placeBraces(this.cy, this.summaries, this.axis);
  }

  /**
   * 拖完松手落在哪。附近有别的节点和它差不多在一条线上，就和那个节点对齐——
   * 自动排的节点是按内容算的间距，不在小格子上，只吸格子反而对不齐；旁边没有可对齐的才吸格子。
   */
  /** 吸附：往别的节点的边和中线上对齐（见 snap.ts）。关掉吸附就停在松手的地方 */
  private snapResult(n: any) {
    const p = n.position();
    if (!this.plugin.settings.snap) return { x: p.x, y: p.y, vx: null, hy: null };
    const linked = new Set<string>(n.neighborhood("node").map((m: any) => m.id()));
    const box = (m: any) => ({ x: m.position("x"), y: m.position("y"), w: m.outerWidth(), h: m.outerHeight(), linked: linked.has(m.id()) });
    const others = this.mainNodes()
      .filter((m: any) => m.id() !== n.id() && !m.hasClass("ghost"))
      .map(box);
    // 范围按屏幕上 14 像素算：放大缩小时手感一样
    return snapTo(box(n), others, 14 / (this.cy.zoom() || 1));
  }

  private snapPoint(n: any): Point {
    // 不取整：别的节点的坐标常带小数，取整后差半个像素，折线就会多出一个小拐弯
    const r = this.snapResult(n);
    return { x: r.x, y: r.y };
  }

  /** 拖的时候画对齐参考线：松手就会贴到这条线上 */
  private showGuides(n: any | null) {
    if (!this.guideV || !this.guideH) return;
    const r = n ? this.snapResult(n) : null;
    const pan = this.cy?.pan() ?? { x: 0, y: 0 };
    const z = this.cy?.zoom() ?? 1;
    if (r && r.vx !== null) {
      this.guideV.style.left = r.vx * z + pan.x + "px";
      this.guideV.show();
    } else this.guideV.hide();
    if (r && r.hy !== null) {
      this.guideH.style.top = r.hy * z + pan.y + "px";
      this.guideH.show();
    } else this.guideH.hide();
  }

  /**
   * 自动排的节点按「内容算出来的间距」摆；拖过的节点放回拖到的位置。
   * 间距交给 pack.ts：同一列的节点按其中最宽的那个定列宽，同一排按最高的定行高，
   * 所以短标签不会白占地方，换行换到三四行的长节点也不会和邻居叠在一起。
   */
  private layout() {
    if (!this.cy) return;
    const pos = this.data.pos;
    const list: any[] = this.mainNodes().toArray();
    const auto = layoutPoints(
      list.map((n) => {
        // 备注在节点正下方，把它的高度算进这个格子里，下一排才不会压到它
        const note = this.cy.getElementById(n.id() + "::note");
        return {
          col: n.data("col") ?? 0,
          row: n.data("row") ?? 0,
          // 备注在节点正下方：高度算进去，宽度取两者里大的，左右的邻居才不会压到它
          w: Math.max(n.outerWidth(), note.nonempty() ? note.outerWidth() : 0),
          h: n.outerHeight() + (note.nonempty() ? note.outerHeight() + 4 : 0),
          polar: n.data("polar"),
          fish: n.data("fish"),
          inLabel: n.data("inLabel"),
          inKind: n.data("inKind"),
          summary: n.hasClass("summary-node"),
        };
      }),
      this.structure,
      this.axis,
    );
    this.placing = true;
    try {
      list.forEach((n, i) => n.position(pos[n.data("key")] ?? auto[i]));
      if (this.rings.length) placeRings(this.cy, this.rings, this.axis, (n: any) => !!pos[n.data("key")]);
      list.forEach((n) => this.placeNote(n));
    } finally {
      this.placing = false;
    }
    this.placeSummaries();
    this.updateRefs();
    this.updateCurves();
    this.updateStatus();
  }

  private fit() {
    if (!this.cy || this.stage.clientWidth === 0) return;
    this.cy.fit(undefined, 40);
    if (this.cy.zoom() > 1.2) {
      this.cy.zoom(1.2);
      this.cy.center();
    }
    this.fitted = true;
    this.userMoved = false;
  }

  private updateStatus() {
    if (!this.cy || this.opts.readonly) return; // 网页里没有状态行
    const total = this.mainNodes().length;
    let kept = 0;
    this.mainNodes().forEach((n: any) => {
      if (this.data.pos[n.data("key")]) kept++;
    });
    const tip = t("status.tip");
    const where = kept > 0 ? t("status.kept", { total, kept }) : t("status.auto", { total });
    const unsaved = this.notePath ? "" : t("status.unsaved");
    this.status.empty();
    // 有问题的行：每条后面跟一个「去这一行」，点了跳到笔记里那一行，长文档里不用自己找
    for (const w of this.warnings) {
      const item = this.status.createEl("span", { cls: "outline-flow-warning", text: w.text });
      const path = this.notePath;
      if (w.find && path) {
        const go = item.createEl("a", { cls: "outline-flow-goto", text: t("status.goto"), href: "#" });
        go.addEventListener("click", (e) => {
          e.preventDefault();
          void this.plugin.revealLine(path, w.find);
        });
      }
      this.status.append(" ");
    }
    this.status.append(t("status.line", { where, tip, unsaved }));
    this.status.toggleClass("has-warning", this.warnings.length > 0);
    if (this.resetBtn) this.resetBtn.disabled = kept === 0;
  }

  private queueSave() {
    if (!this.notePath || this.opts.readonly) return; // 网页里折叠备注只在当前页面里生效，不存
    this.plugin.broadcast(this);
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.saveNow(), 300);
  }

  private saveNow() {
    this.saveTimer = null;
    if (this.notePath) void this.plugin.saveNote(this.notePath);
  }
}

/** 侧栏面板：跟着当前笔记走，显示光标所在的那张图 */
class SideView extends ItemView {
  private flow: FlowView | null = null;
  private shownKey = "";
  private lastPath = "";
  private lastIndex = 0;
  private lastLine = -1;
  /** 内容变过（editor-change 打的标记），下次刷新不能只看光标就跳过 */
  private dirty = true;
  /** 上一趟发现侧栏是收着的 */
  private wasHidden = false;
  private timer: number | null = null;
  private body!: HTMLElement;

  constructor(leaf: WorkspaceLeaf, private plugin: OutlineFlowPlugin) {
    super(leaf);
  }

  getViewType() {
    return SIDE_VIEW;
  }
  getDisplayText() {
    return t("side.title");
  }
  getIcon() {
    return "workflow";
  }

  async onOpen() {
    this.contentEl.empty();
    this.contentEl.addClass("outline-flow-side");
    this.body = this.contentEl.createDiv({ cls: "outline-flow-side-body" });
    const later = () => this.queue();
    this.registerEvent(this.app.workspace.on("active-leaf-change", later));
    this.registerEvent(this.app.workspace.on("file-open", later));
    // 内容变了记一笔。600ms 那一路光看光标分不出「只是光标动了」和「字改了」，
    // 靠这个标记区分，免得每次都去 getValue() 扫全文。
    this.registerEvent(
      this.app.workspace.on("editor-change", () => {
        this.dirty = true;
        later();
      }),
    );
    // 光标移到另一张图里没有专门的事件，隔一会儿看一眼（只读光标，很便宜）
    this.registerInterval(window.setInterval(later, 600));
    await this.refresh();
  }

  async onClose() {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.clear();
  }

  private queue() {
    if (this.timer !== null) return;
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.refresh();
    }, 250);
  }

  private clear() {
    this.flow?.unload();
    this.flow = null;
  }

  private message(key: string, text: string) {
    if (this.shownKey === key) return;
    this.shownKey = key;
    this.clear();
    this.body.empty();
    this.body.createDiv({ cls: "outline-flow-message", text });
  }

  /** 侧栏被收起或藏起来时整块是 display:none，getClientRects() 为空 */
  private isVisible(): boolean {
    const el = this.containerEl;
    return !!el && el.getClientRects().length > 0;
  }

  /**
   * 刷新规则（省 CPU 的关键，别改回「每次都 getValue 扫全文」）：
   * 1. 侧栏收着 → 什么都不做，只记一笔状态，展开后补上；
   * 2. 笔记没换、光标没动、内容也没改 → 直接返回，只花一次 getCursor()；
   * 3. 同一张图只是内容变了 → 就地 update()，不销毁 cytoscape 实例。
   */
  private async refresh() {
    // 焦点在侧栏自己身上时：继续显示刚才那篇笔记；刚启动还没有"刚才"，就用最近用过的那篇
    const open = this.app.workspace
      .getLeavesOfType("markdown")
      .map((l) => l.view)
      .filter((v): v is MarkdownView => v instanceof MarkdownView && !!v.file);
    const recent = this.app.workspace.getMostRecentLeaf()?.view;
    const md =
      this.app.workspace.getActiveViewOfType(MarkdownView) ??
      open.find((v) => v.file?.path === this.lastPath) ??
      (recent instanceof MarkdownView && recent.file ? recent : undefined) ??
      open[0];
    if (!md || !md.file) {
      this.message("none", t("side.none"));
      return;
    }

    const path = md.file.path;
    const line = md.editor.getCursor().line;

    // 1. 收着就不画；什么都没变也不画。这里只花一次 getCursor()。
    const g = gate({
      path,
      line,
      lastPath: this.lastPath,
      lastLine: this.lastLine,
      shownKey: this.shownKey,
      dirty: this.dirty,
      wasHidden: this.wasHidden,
      visible: this.isVisible(),
    });
    if (g === "hidden") {
      this.wasHidden = true;
      this.dirty = true;
      this.lastPath = path;
      this.lastLine = line;
      return;
    }
    this.wasHidden = false;
    this.dirty = false;
    if (g === "idle") return;
    const sameFile = path === this.lastPath;
    this.lastLine = line;

    const text = md.editor.getValue();
    const blocks = findFlowBlocks(text);
    // 没有 flow 代码块时：把整篇笔记的正文大纲（列表）抽出来当一张图
    const outline = blocks.length === 0 ? extractOutlineFromMarkdown(text) : "";
    if (blocks.length === 0 && !outline.trim()) {
      this.lastPath = path;
      this.lastIndex = 0;
      this.message("empty:" + path, t("side.empty"));
      return;
    }

    const picked = pickDiagram(path, line, this.lastPath, this.lastIndex, blocks, outline);
    const { index, diagramId, source, key } = picked;
    if (key === this.shownKey) {
      this.lastPath = path;
      this.lastIndex = index;
      return;
    }

    const sameDiagram = sameFile && index === this.lastIndex;
    const viewport = sameDiagram ? this.flow?.getViewport() ?? null : null;
    this.shownKey = key;
    this.lastPath = path;
    this.lastIndex = index;

    // 3. 同一张图只是内容变了：就地重画，不销毁 cytoscape 实例
    if (sameDiagram && this.flow) {
      this.flow.update(source);
      return;
    }

    const note = await this.plugin.loadNote(path);
    if (this.shownKey !== key) return; // 等数据的时候又换了
    this.clear();
    this.body.empty();
    const host = this.body.createDiv();
    this.flow = new FlowView(host, this.plugin, source, path, diagramId, note, { fill: true, viewport });
    this.flow.load();
  }
}

class OutlineFlowSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: OutlineFlowPlugin) {
    super(app, plugin);
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.settings;

    new Setting(containerEl)
      .setName(t("settings.folder.name"))
      .setDesc(t("settings.folder.desc"))
      .addText((text) => {
        text.setValue(s.folder);
        text.inputEl.addEventListener("blur", async () => {
          const next = normalizePath(text.getValue().trim());
          if (next === s.folder) return;
          if (!next || next === "/" || next.startsWith(".")) {
            new Notice(t("settings.folder.invalid", { folder: s.folder }));
            text.setValue(s.folder);
            return;
          }
          try {
            const moved = await this.plugin.moveFolder(s.folder, next);
            if (!moved) {
              new Notice(t("settings.folder.exists", { next, folder: s.folder }));
              text.setValue(s.folder);
              return;
            }
          } catch (e) {
            console.error("[outline-flow] failed to move folder", e);
            new Notice(t("settings.folder.moveFailed", { folder: s.folder }));
            text.setValue(s.folder);
            return;
          }
          s.folder = next;
          text.setValue(next);
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName(t("settings.newStyle.name"))
      .setDesc(t("settings.newStyle.desc"))
      .addDropdown((dd) => {
        dd.addOption("last", t("settings.newStyle.last"));
        dd.addOption("fixed", t("settings.newStyle.fixed"));
        dd.setValue(s.newStyle).onChange(async (v) => {
          s.newStyle = v as Settings["newStyle"];
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName(t("settings.theme.name"))
      .setDesc(t("settings.theme.desc"))
      .addDropdown((dd) => {
        for (const key of Object.keys(THEMES)) dd.addOption(key, themeName(key));
        dd.setValue(s.theme).onChange(async (v) => {
          s.theme = v;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName(t("settings.structure.name"))
      .setDesc(t("settings.structure.desc"))
      .addDropdown((dd) => {
        for (const o of structureOptions()) dd.addOption(o.value, o.label);
        dd.setValue(liveStructure(s.structure)).onChange(async (v) => {
          s.structure = v as Structure;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName(t("settings.snap.name"))
      .setDesc(t("settings.snap.desc"))
      .addToggle((tg) => {
        tg.setValue(s.snap).onChange(async (v) => {
          s.snap = v;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName(t("settings.height.name"))
      .setDesc(t("settings.height.desc", { min: MIN_HEIGHT, max: MAX_HEIGHT }))
      .addText((text) => {
        text.inputEl.type = "number";
        text.setValue(String(s.height));
        text.inputEl.addEventListener("blur", async () => {
          const n = Number(text.getValue());
          if (!Number.isFinite(n) || n < MIN_HEIGHT || n > MAX_HEIGHT) {
            new Notice(t("settings.height.invalid", { min: MIN_HEIGHT, max: MAX_HEIGHT, height: s.height }));
            text.setValue(String(s.height));
            return;
          }
          s.height = Math.round(n);
          await this.plugin.saveSettings();
        });
      });
  }
}
