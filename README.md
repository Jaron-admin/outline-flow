# Outline Flow

Outline Flow draws mind maps in Obsidian. There are two ways to use it:

- **In a note, with a code block.** Write an `outline-flow` code block (the older `flow` name also works), one indented line per node. The chart updates as you type.
- **In the side panel, without a code block.** Open the side panel and the note's `#` headings and lists are drawn as one mind map. Edit a node on the map and the change is written back to the heading or list item in the note.

The syntax is compatible with [Flowchart Fun](https://flowchart.fun) and adds loops, summary braces and notes under nodes. Switch between four layouts at any time, pick from 17 themes, or export a note's charts as one HTML file that opens in a browser.

[中文说明](#中文说明)

## What it does

- **The chart is drawn from the note.** There is no second copy of your outline. The note stays plain Markdown: no frontmatter and no hidden markers. Only the positions of nodes you drag are stored in a vault folder, one JSON file per note (see [Data](#data)).
- **Loops, summaries and labels.** `(name)` links back to an earlier node, and a chain that returns to its start is drawn as a regular polygon. A `}` line wraps the siblings above it in a summary brace. Write `label: node` to put text on the connector.
- **Export one HTML file.** Export every chart in a note to a single self-contained HTML page. It opens in a browser, needs no Obsidian install and no account, and follows the viewer's light or dark mode.

## Editing

- **Live rendering.** Charts update as you type. There is no generate button and no rebuild step.
- **Switch layouts.** Mind map, logic chart (left to right), org chart (top down) and radial map. Same outline, different shape, one switch in the toolbar.
- **Keyboard editing.** Edit on the chart the way you would in a mind-mapping app: click a node, then Enter adds a sibling, Tab adds a child, Shift+Tab promotes, Space or F2 edits the text, Delete removes the node with its children, Alt+↑/↓ moves it among its siblings. Undo and redo with ⌘Z / ⌘⇧Z (Ctrl+Z / Ctrl+Y).
- **Right-click menu.** Right-click a node to add a child or sibling, edit, move, promote, delete, open its link or show it in the note. Right-click empty space to fit the chart, re-layout or export.
- **Follow the note.** Click a node on the chart in the side panel and the note scrolls to that line (can be turned off in settings).
- **Drag and snap.** Move nodes anywhere; they snap to other nodes' edges and center lines, with guides. Positions are saved per note.
- **17 themes** in two groups: branch colors (each first-level branch gets its own color) and single color.
- **Links.** ⌘/Ctrl + click a node to open its URL or `[[note]]`.
- **Notes under nodes.** Text in `【】` shows in small type under the node and can be folded.
- **Markdown inside nodes.** Bold, code, links and wikilinks render as clean text.

## Install

In Obsidian: Settings → Community plugins → Browse → search "Outline Flow" → Install, then Enable.

## Syntax

````markdown
```outline-flow
Order placed
  Check stock
    In stock: Charge card
      Failed: (Order placed)
    Out of stock: Notify customer【send within 1 hour】
  } Fulfilment
```
````

| You write | It means |
| --- | --- |
| Indent one level | Child of the line above (spaces or tabs) |
| `label: node` | Text on the connecting line |
| `(node)` | Link back to a node written earlier |
| `node【note】` | A note shown under the node |
| `} summary` | Brace around the siblings above, with a summary |
| `- `, `* `, `1. `, `#` headings | Ordinary Markdown outlines work too |

The older `flow` block name still works. If another plugin already uses `flow`, use `outline-flow`.

## Mobile

Works on phones and tablets. Charts inside code blocks are view-only on touch screens so the note scrolls normally; drag and edit in the side panel.

## Data

Node positions are stored as JSON files in a vault folder (`Outline Flow positions` by default, configurable in settings), one file per note. Nothing is sent over the network.

## Language

The interface follows Obsidian's language: Chinese when Obsidian is set to Chinese, English otherwise.

## License

GPL-3.0. Third-party libraries: see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

---

## 中文说明

Outline Flow 在 Obsidian 里画思维导图。有两种用法：

- **写代码块**：在笔记里写一个 `outline-flow` 代码块（老的 `flow` 也能用），一行一个节点，缩进表示层级。边打字边出图。
- **用侧栏**：笔记里不写代码块，打开侧栏，整篇笔记的 `#` 标题和列表会画成一张思维导图。在图上改节点，改动会写回笔记的标题和列表。

语法兼容 [Flowchart Fun](https://flowchart.fun)，另加了回环、概要括号和节点备注。四种版式随时切换，17 套主题，还能把整篇笔记的图导出成一个 HTML 文件，用浏览器打开就能看。

### 能做什么

- **图从笔记文字画出来**：没有另存一份大纲。笔记本身保持纯 Markdown，不加 frontmatter，也不加隐藏标记。只有你拖过的节点位置会另外保存到库里的一个文件夹（每篇笔记一个 JSON，见「数据」）。
- **回环、概要和连线文字**：`(名字)` 连回前面的节点，一串连回开头会摆成正多边形；`}` 给上面的兄弟套一个概要括号；`label: 节点` 在连线上写字。
- **导出单个 HTML**：把一篇笔记里的图导出成一个自包含的 HTML 页面。用浏览器打开就能看，不用装 Obsidian，不用账号，还跟随对方系统的深浅色。

### 用起来

- **实时**：打字就渲染，没有「生成」按钮，不用重新构建。
- **版式随时切**：思维导图、逻辑图（向右）、组织结构图（向下）、放射图。同一份大纲，换个形状。
- **键盘编辑**：像常见的思维导图软件那样直接在图上改：点节点后回车加同级、Tab 加下级、Shift+Tab 提一级、空格或 F2 改字、Delete 连下级一起删、⌥↑↓ 和同级换位置；⌘Z / ⌘⇧Z（Ctrl+Z / Ctrl+Y）撤回、重做。
- **右键菜单**：在节点上右键可以加下级、加同级、改字、上移下移、提一级、删除、打开链接、在笔记里定位；在空白处右键可以适应窗口、重新自动排版、导出网页。
- **笔记跟着滚**：在侧栏的图上点一个节点，笔记就滚到对应那一行（设置里可以关掉）。
- **拖动吸附**：拖到哪都行，会贴到别的节点的边和中线，有参考线；位置按笔记记住。
- **17 套主题**：分「分支配色」和「单色」两组。
- **链接**：⌘ 或 Ctrl + 单击节点，打开网址或 `[[笔记]]`。
- **备注**：`【】` 里的字显示在节点下方，可以收起。
- **节点里的 Markdown**：加粗、代码、链接、双链都显示成干净的文字。

### 安装

Obsidian → 设置 → 第三方插件 → 浏览 → 搜索 "Outline Flow" → 安装并启用。

### 语法

````markdown
```outline-flow
订单下达
  检查库存
    有货: 扣款
      失败: (订单下达)
    缺货: 通知客户【1 小时内发出】
  } 履约
```
````

| 写法 | 含义 |
| --- | --- |
| 缩进一级 | 成为上一行的下级（空格或 Tab 都行） |
| `label: 节点` | 连线上显示文字 |
| `(节点)` | 连回前面写过的节点 |
| `节点【备注】` | 节点下方显示备注 |
| `} 概要` | 用大括号把上面的兄弟括起来 |
| `- `、`* `、`1. `、`#` 标题 | 普通 Markdown 大纲也能直接画 |

老的 `flow` 写法照样能用；如果别的插件也用了 `flow`，请用 `outline-flow`。

### 手机

手机、平板上能正常用。笔记里代码块的图在触屏上只用来看，手指滑动直接翻笔记；要拖、要改，去侧栏的图上操作。

### 数据

拖过的节点位置存在库里的「流程图位置」文件夹（设置里可以改），一篇笔记一个 JSON 文件。不联网，不上传任何东西。

### 语言

界面跟着 Obsidian 的语言走：Obsidian 设成中文就是中文，其他语言显示英文。

### 许可

GPL-3.0。用到的第三方库见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
