// 界面语言：英文 / 中文。
// 当前语言是模块级的一个变量，默认中文；插件 onload 第一件事是按 Obsidian 的语言设好（见 detectLang）。
// 导出的网页里由页面数据里存的 lang 设（见 web.ts）。
// 这个文件不 import "obsidian"：纯函数和两份词典，测试和网页查看器都能直接打包它。
// 代码里的注释还是中文；只有会显示给用户看的字放在这里。

export type Lang = "en" | "zh";

/** 老版本（1.0.0）默认的位置文件夹。已经存过设置的人不动；没存过设置的老用户见 main.ts 的 onload */
export const LEGACY_FOLDER = "流程图位置";

let current: Lang = "zh";

export function setLang(l: Lang): void {
  current = l;
}

export function getLang(): Lang {
  return current;
}

/**
 * 按 Obsidian 的界面语言选：语言代码以 zh 开头就是中文，别的都是英文。
 * 传进来的是 `import * as obsidian from "obsidian"` 的整个模块：getLanguage() 是 1.8.7 才有的，
 * minAppVersion 是 1.5.0，所以先看有没有这个函数；没有就读 Obsidian 存在 localStorage 里的 "language"
 * （没存过就是英文）。
 */
export function detectLang(obsidianModule?: unknown): Lang {
  let code: string | null | undefined;
  const fn = (obsidianModule as { getLanguage?: unknown } | null | undefined)?.getLanguage;
  if (typeof fn === "function") {
    try {
      code = String((fn as () => unknown)());
    } catch {
      code = undefined;
    }
  }
  if (!code) {
    try {
      code = typeof window !== "undefined" ? window.localStorage?.getItem("language") : null;
    } catch {
      code = null;
    }
  }
  return code && /^zh/i.test(code) ? "zh" : "en";
}

const zh = {
  // ---- 工具条 ----
  "toolbar.structure": "结构",
  "toolbar.theme": "主题",
  "toolbar.nearRefs": "关联靠近",
  "toolbar.nearRefs.tip": "开着时，同一层的节点按虚线的关系重新排先后，有关联的挨在一起、虚线变短。只改图上的顺序，大纲不动。",
  "toolbar.snap": "吸附",
  "toolbar.snap.tip": "开着时，拖节点会贴到别的节点的边和中线上，拖的时候有参考线。",
  "toolbar.relayout": "重新自动排版",
  "toolbar.copyFlowchartFun": "复制为 Flowchart Fun 格式",
  "toolbar.exportPage": "导出网页",
  "toolbar.hideNotes": "隐藏备注",
  "toolbar.showNotes": "显示备注",
  "toolbar.fit": "适应窗口",
  "toolbar.fullscreen": "全屏",
  "toolbar.exitFullscreen": "退出全屏",
  "toolbar.dirFixed": "{structure}的排布方向是固定的",

  // ---- 主题、结构、线型、方向的名字 ----
  "theme.card": "浅色卡片",
  "theme.dark": "深色",
  "theme.aurora": "极光",
  "theme.neon": "霓虹",
  "theme.mint": "薄荷",
  "theme.sunset": "日落",
  "theme.paper": "手稿",
  "theme.mono": "极简黑白",
  "theme.yellow": "黄色重点",
  "theme.colorful": "缤纷",
  "theme.morandi": "莫兰迪",
  "theme.fog": "雾蓝",
  "theme.plain": "素白",
  "theme.inkpaper": "纸墨",
  "theme.night": "夜航",
  "theme.pine": "松烟",
  "theme.print": "打印",
  "themeGroup.branch": "分支配色",
  "themeGroup.single": "单色",
  "structure.mindmap": "思维导图",
  "structure.logic": "逻辑图",
  "structure.org": "组织结构图",
  "structure.radial": "放射图",
  "structure.trunk": "主干图",
  "structure.flow": "流程图",
  "structure.brace": "括号图",
  "structure.timeline": "时间轴",
  "structure.fishbone": "鱼骨图",
  "line.poly": "折线",
  "line.straight": "直线",
  "line.curve": "弧线",
  "direction.LR": "从左到右",
  "direction.TB": "从上到下",

  // ---- 图下面和图右下角的提示 ----
  "hint.pan.focused": "拖动平移 · 滚轮 缩放",
  "hint.pan.idle": "拖动平移 · 按住 {mod} 滚动缩放",
  "hint.editing": "回车 确定 · Esc 取消",
  "hint.selected": "回车 加同级 · Tab 加下级 · ⇧Tab 提一级 · ⌥↑↓ 上移下移 · 空格 改字 · Delete 删除 · {undo} 撤回 · 右键 更多",
  "menu.addChild": "加下级",
  "menu.addSibling": "加同级",
  "menu.edit": "改字",
  "menu.promote": "提一级",
  "menu.moveUp": "上移",
  "menu.moveDown": "下移",
  "menu.remove": "删除（连同下级）",
  "menu.openLink": "打开链接",
  "menu.reveal": "在笔记里定位",
  "settings.clickToJump.name": "点节点时笔记跟着滚动",
  "settings.clickToJump.desc": "在侧栏的图上点一个节点，打开着的笔记会滚到这个节点对应的那一行，并把它选中。笔记里代码块的图不受影响。",
  "hint.zoom": "滚轮 缩放 · 拖空白处 平移",

  // ---- 状态行 ----
  "status.tip": "拖节点调位置，按住 Cmd 或 Ctrl 滚动来缩放。",
  "status.kept": "{total} 个节点，其中 {kept} 个在你拖到的位置。",
  "status.auto": "{total} 个节点，现在是自动排的位置。",
  "status.unsaved": " 这张图这次不会记住位置。",
  "status.line": "{where}{tip}{unsaved}",
  "status.goto": "去这一行",

  // ---- 图上的提示、输入 ----
  "overlay.empty": "在代码块里写一行字，这里就会出现一个节点。",
  "overlay.parseError": "这段大纲有一处读不懂：{reason}。改好之后图会自动出来。",
  "overlay.parseError.default": "请检查缩进和括号",
  "input.placeholder": "输入文字",
  "input.newLabel": "新节点文字",
  "link.note": "笔记「{name}」",
  "link.openTip": "{mod}+单击打开：{links}",
  "toast.undone": "已撤回",
  "toast.redone": "已重做",
  "toast.nothingToUndo": "没有可以撤回的了",
  "toast.nothingToRedo": "没有可以重做的了",
  "toast.lineMismatch": "这一行在笔记里对不上，请直接在笔记里改",
  "undo.conflict": "笔记在别处改过了，这一步撤回不了",
  "redo.conflict": "笔记在别处改过了，这一步重做不了",
  "copy.ok": "复制好了，可以直接贴到 flowchart.fun。",
  "copy.fail": "没能复制。请手动选中代码块里的文字复制。",

  // ---- 改笔记失败的原因和提示 ----
  "edit.noteNotFound": "找不到这篇笔记",
  "edit.failed": "这一步没做成",
  "edit.noRow": "这个节点在笔记里找不到对应的行",
  "edit.emptyText": "字不能是空的",
  "edit.headingInBlockAdd": "代码块里有 # 标题，层级没法直接加，请在笔记里改",
  "edit.headingInBlockEdit": "代码块里有 # 标题，层级没法直接改，请在笔记里改",
  "edit.promoteHeading": "标题不能提一级，请在笔记里改 # 的个数",
  "edit.topLevel": "已经是最上面一级了",
  "edit.firstAlready": "已经是这一层的第一个了",
  "edit.lastAlready": "已经是这一层的最后一个了",
  "edit.diagramGone": "笔记里找不到这张图了",
  "edit.noteChanged": "笔记刚刚变了，图还没跟上，稍等一下再试",
  "edit.removedSection": "删掉了整节，⌘Z 可以撤回",

  // ---- 大纲写法的警告 ----
  "warn.reason.edgeLabelNoParent": "最外层的行里有「冒号+空格」，流程图会把冒号前面当成线上的字，可这一行没有上一级",
  "warn.reason.pointer": "半角括号 ( ) 在流程图里是「连回某个节点」，和这一行的其他字放在一起读不通",
  "warn.reason.duplicateId": "#名字 在流程图里是节点编号，和前面的重复了",
  "warn.reason.default": "这一行的写法流程图读不懂",
  "warn.line": "「{snippet}」这一行：{reason}。图上先按原文显示。",
  "warn.flatBrace": "时间轴、鱼骨图和发散图没有地方画大括号，} 那几行先不显示。",
  "warn.braceNothing": "第 {line} 行的 } 前面没有可以括的节点。它要和被括的那几行缩进一样、写在它们后面。",
  "summary.previous": "概要前 {count} 项",
  "summary.plain": "概要",

  // ---- 侧栏 ----
  "side.title": "流程图",
  "side.none": "打开一篇笔记，这里会显示它里面的流程图。",
  "side.empty": "这篇笔记里还没有标题或列表。用 # 写几个标题，或者用 - 写几行，图就会出现在这里。",

  // ---- 命令、导出 ----
  "command.openSide": "在侧栏显示流程图",
  "command.exportHtml": "导出为网页",
  "export.folder": "流程图网页",
  "export.onlyMarkdown": "只能导出 Markdown 笔记。",
  "export.noViewer": "这个版本里没有带网页查看器，没法导出。请用 npm run build 重新构建插件。",
  "export.noCharts": "这篇笔记里没有 flow 代码块，也没有标题或列表，没有图可以导出。",
  "export.done": "导出好了：{path}",
  "export.failed": "没能导出网页。请检查「{folder}」文件夹能不能写入。",
  "export.chartN": "图 {n}",
  "export.meta": "{n} 张流程图 · {date} 导出",
  "export.metaOne": "{n} 张流程图 · {date} 导出",
  "save.failed": "节点位置没能存下来。请检查「{folder}」文件夹能不能写入。",

  // ---- 设置页 ----
  "settings.folder.name": "位置存在哪个文件夹",
  "settings.folder.desc": "你拖过的节点位置存在库里的这个文件夹，不写进笔记。改名后，原来的文件夹会一起搬过去。",
  "settings.folder.default": LEGACY_FOLDER,
  "settings.folder.invalid": "文件夹名不能留空，也不能以点开头。已改回「{folder}」。",
  "settings.folder.exists": "「{next}」已经存在，换一个名字。已改回「{folder}」。",
  "settings.folder.moveFailed": "文件夹没能搬过去，已改回「{folder}」。",
  "settings.newStyle.name": "新图的样式",
  "settings.newStyle.desc":
    "跟上一张图一样：在任何一张图上换了主题或结构，之后新打开的图就用这一套。用固定的样式：新图一律用下面选的主题和结构。已经画过的图都记着自己的样式，不受影响。",
  "settings.newStyle.last": "跟上一张图一样",
  "settings.newStyle.fixed": "用固定的样式",
  "settings.theme.name": "新图用哪套主题",
  "settings.theme.desc": "选「跟上一张图一样」时，这里会随你最近一次换的主题自动更新。每张图可以在图上方另选。",
  "settings.structure.name": "新图用哪种结构",
  "settings.structure.desc": "思维导图从中间往左右两边长；逻辑图一直往右；组织结构图从上往下；放射图从中心往四周一圈圈展开。每张图可以在图上方另选。",
  "settings.snap.name": "拖节点时吸附对齐",
  "settings.snap.desc":
    "开着时，拖节点会贴到附近别的节点的左边、中线、右边（上边、中线、下边）上，拖的时候有参考线。关掉就停在松手的地方。图上方的「吸附」按钮也能开关。",
  "settings.height.name": "图的高度",
  "settings.height.desc": "单位是像素，{min} 到 {max} 之间。重新打开笔记后变。",
  "settings.height.invalid": "高度要在 {min} 到 {max} 之间。已改回 {height}。",
} as const;

const en: Record<keyof typeof zh, string> = {
  "toolbar.structure": "Structure",
  "toolbar.theme": "Theme",
  "toolbar.nearRefs": "Group related",
  "toolbar.nearRefs.tip":
    "When on, nodes at the same level are reordered by their dashed links, so related nodes sit together and dashed lines get shorter. Only the order on the chart changes; the outline stays the same.",
  "toolbar.snap": "Snap",
  "toolbar.snap.tip": "When on, dragged nodes snap to the edges and center lines of other nodes, with guide lines while you drag.",
  "toolbar.relayout": "Re-layout",
  "toolbar.copyFlowchartFun": "Copy as Flowchart Fun",
  "toolbar.exportPage": "Export web page",
  "toolbar.hideNotes": "Hide notes",
  "toolbar.showNotes": "Show notes",
  "toolbar.fit": "Fit",
  "toolbar.fullscreen": "Full screen",
  "toolbar.exitFullscreen": "Exit full screen",
  "toolbar.dirFixed": "{structure} always uses a fixed layout direction",

  "theme.card": "Light Card",
  "theme.dark": "Dark",
  "theme.aurora": "Aurora",
  "theme.neon": "Neon",
  "theme.mint": "Mint",
  "theme.sunset": "Sunset",
  "theme.paper": "Manuscript",
  "theme.mono": "Mono",
  "theme.yellow": "Yellow Accent",
  "theme.colorful": "Colorful",
  "theme.morandi": "Morandi",
  "theme.fog": "Fog Blue",
  "theme.plain": "Plain",
  "theme.inkpaper": "Ink & Paper",
  "theme.night": "Night",
  "theme.pine": "Pine Smoke",
  "theme.print": "Print",
  "themeGroup.branch": "Branch colors",
  "themeGroup.single": "Single color",
  "structure.mindmap": "Mind map",
  "structure.logic": "Logic chart",
  "structure.org": "Org chart",
  "structure.radial": "Radial map",
  "structure.trunk": "Trunk",
  "structure.flow": "Flowchart",
  "structure.brace": "Brace map",
  "structure.timeline": "Timeline",
  "structure.fishbone": "Fishbone",
  "line.poly": "Elbow",
  "line.straight": "Straight",
  "line.curve": "Curved",
  "direction.LR": "Left to right",
  "direction.TB": "Top to bottom",

  "hint.pan.focused": "Drag to pan · Scroll to zoom",
  "hint.pan.idle": "Drag to pan · Hold {mod} and scroll to zoom",
  "hint.editing": "Enter: confirm · Esc: cancel",
  "hint.selected": "Enter: add sibling · Tab: add child · ⇧Tab: promote · ⌥↑↓: move up/down · Space: edit text · Delete: remove · {undo}: undo · Right-click: more",
  "menu.addChild": "Add child",
  "menu.addSibling": "Add sibling",
  "menu.edit": "Edit text",
  "menu.promote": "Promote",
  "menu.moveUp": "Move up",
  "menu.moveDown": "Move down",
  "menu.remove": "Delete (with children)",
  "menu.openLink": "Open link",
  "menu.reveal": "Show in note",
  "settings.clickToJump.name": "Scroll the note when clicking a node",
  "settings.clickToJump.desc": "Clicking a node on the chart in the side panel scrolls the open note to that node's line and selects it. Charts in code blocks are not affected.",
  "hint.zoom": "Scroll to zoom · Drag empty space to pan",

  "status.tip": "Drag nodes to move them. Hold Cmd or Ctrl and scroll to zoom.",
  "status.kept": "{total} nodes, {kept} at positions you dragged them to.",
  "status.auto": "{total} nodes, positions are automatic.",
  "status.unsaved": " Positions won't be remembered for this chart.",
  "status.line": "{where} {tip}{unsaved}",
  "status.goto": "Go to line",

  "overlay.empty": "Write a line in the code block and a node will appear here.",
  "overlay.parseError": "Part of this outline can't be read: {reason}. The chart will appear once it's fixed.",
  "overlay.parseError.default": "check the indentation and brackets",
  "input.placeholder": "Type text",
  "input.newLabel": "New node text",
  "link.note": "Note \"{name}\"",
  "link.openTip": "{mod}+click to open: {links}",
  "toast.undone": "Undone",
  "toast.redone": "Redone",
  "toast.nothingToUndo": "Nothing to undo",
  "toast.nothingToRedo": "Nothing to redo",
  "toast.lineMismatch": "This line doesn't match the note. Edit it in the note instead.",
  "undo.conflict": "The note was changed elsewhere, so this can't be undone",
  "redo.conflict": "The note was changed elsewhere, so this can't be redone",
  "copy.ok": "Copied. You can paste it straight into flowchart.fun.",
  "copy.fail": "Couldn't copy. Select the text in the code block and copy it manually.",

  "edit.noteNotFound": "Can't find this note",
  "edit.failed": "That didn't work",
  "edit.noRow": "Can't find the line for this node in the note",
  "edit.emptyText": "Text can't be empty",
  "edit.headingInBlockAdd": "This code block has # headings, so levels can't be added here. Edit them in the note.",
  "edit.headingInBlockEdit": "This code block has # headings, so levels can't be changed here. Edit them in the note.",
  "edit.promoteHeading": "A heading can't be promoted. Change the number of # in the note.",
  "edit.topLevel": "Already at the top level",
  "edit.firstAlready": "Already first at this level",
  "edit.lastAlready": "Already last at this level",
  "edit.diagramGone": "Can't find this chart in the note anymore",
  "edit.noteChanged": "The note just changed and the chart hasn't caught up. Wait a moment and try again.",
  "edit.removedSection": "Deleted the whole section. Press ⌘Z to undo.",

  "warn.reason.edgeLabelNoParent":
    "a top-level line has a colon followed by a space. In a flowchart, the text before the colon becomes a label on the link, but this line has no parent",
  "warn.reason.pointer": "half-width parentheses ( ) mean \"link back to a node\" in a flowchart, so they can't be mixed with other text on the same line",
  "warn.reason.duplicateId": "#name is a node ID in a flowchart, and this one repeats an earlier ID",
  "warn.reason.default": "the flowchart can't read how this line is written",
  "warn.line": "Line \"{snippet}\": {reason}. Shown as plain text for now.",
  "warn.flatBrace": "Timeline, fishbone and radial charts have no room for braces, so lines with } are not shown.",
  "warn.braceNothing": "Line {line}: there is nothing before the } to bracket. It must have the same indent as the lines it covers and come after them.",
  "summary.previous": "Summary of previous {count} items",
  "summary.plain": "Summary",

  "side.title": "Flowchart",
  "side.none": "Open a note to see its flowcharts here.",
  "side.empty": "This note has no headings or lists yet. Write some headings with # or lines with -, and the chart will appear here.",

  "command.openSide": "Show flowchart in sidebar",
  "command.exportHtml": "Export as web page",
  "export.folder": "Outline Flow pages",
  "export.onlyMarkdown": "Only Markdown notes can be exported.",
  "export.noViewer": "This build doesn't include the web viewer, so it can't export. Rebuild the plugin with npm run build.",
  "export.noCharts": "This note has no flow code blocks, headings or lists, so there is nothing to export.",
  "export.done": "Exported: {path}",
  "export.failed": "Couldn't export the web page. Check that the \"{folder}\" folder is writable.",
  "export.chartN": "Chart {n}",
  "export.meta": "{n} charts · exported {date}",
  "export.metaOne": "{n} chart · exported {date}",
  "save.failed": "Couldn't save node positions. Check that the \"{folder}\" folder is writable.",

  "settings.folder.name": "Positions folder",
  "settings.folder.desc": "Node positions you drag are saved in this folder in your vault, not in the notes. If you rename it, the existing folder is moved too.",
  "settings.folder.default": "Outline Flow positions",
  "settings.folder.invalid": "The folder name can't be empty or start with a dot. Changed back to \"{folder}\".",
  "settings.folder.exists": "\"{next}\" already exists. Pick another name. Changed back to \"{folder}\".",
  "settings.folder.moveFailed": "Couldn't move the folder. Changed back to \"{folder}\".",
  "settings.newStyle.name": "Style for new charts",
  "settings.newStyle.desc":
    "Same as last chart: when you change the theme or structure on any chart, charts you open later use it. Fixed style: new charts always use the theme and structure chosen below. Charts you've already drawn keep their own style.",
  "settings.newStyle.last": "Same as last chart",
  "settings.newStyle.fixed": "Fixed style",
  "settings.theme.name": "Theme for new charts",
  "settings.theme.desc": "With \"Same as last chart\", this follows the theme you changed most recently. You can still pick another theme above each chart.",
  "settings.structure.name": "Structure for new charts",
  "settings.structure.desc":
    "Mind map grows left and right from the center; Logic chart grows to the right; Org chart grows downward; Radial map spreads out from the center in rings. You can still pick another structure above each chart.",
  "settings.snap.name": "Snap when dragging",
  "settings.snap.desc":
    "When on, dragged nodes snap to the left, center and right (or top, center and bottom) of nearby nodes, with guide lines while you drag. When off, nodes stay where you drop them. The \"Snap\" button above a chart toggles this too.",
  "settings.height.name": "Chart height",
  "settings.height.desc": "In pixels, between {min} and {max}. Takes effect after you reopen the note.",
  "settings.height.invalid": "Height must be between {min} and {max}. Changed back to {height}.",
};

export type Key = keyof typeof zh;

/** 两份词典，给测试看 */
export const dictionaries: Record<Lang, Record<Key, string>> = { en, zh };

/** 取一句话：{name} 换成 vars 里的值；没给的占位符原样留着。lang 不传就用当前语言 */
export function t(key: Key, vars?: Record<string, string | number>, lang: Lang = current): string {
  const text = dictionaries[lang][key];
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}
