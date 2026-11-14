# Outline Flow

Turn an indented outline into a mind map or flowchart, right inside your notes. Edit the outline on the chart with Enter and Tab, the way you would in a mind-mapping app.

[中文说明在下面](#中文说明)

## Features

- **Write an outline, get a chart.** Put the outline in a `flow` code block, or open the side panel and the whole note's headings and lists become one chart.
- **Four layouts:** mind map, logic chart (left to right), org chart (top down) and radial map.
- **Edit on the chart:** click a node, then Enter adds a sibling, Tab adds a child, Shift+Tab promotes, Space or F2 edits the text, Delete removes the node with its children. Changes are written back to the note. Undo and redo with ⌘Z / ⌘⇧Z (Ctrl+Z / Ctrl+Y).
- **Themes:** 17 themes in two groups — branch colors (each first-level branch gets its own color) and single color.
- **Links:** ⌘/Ctrl + click a node to open its URL or `[[note]]`.
- **Back-references:** write `(name)` to link back to an earlier node. A chain that links back to its start (like the five elements) is drawn as a regular polygon.
- **Summary braces:** a `}` line wraps the siblings above it in a brace with a summary.
- **Notes under nodes:** text in `【】` is shown in small type under the node and can be folded.
- **Drag and snap:** drag nodes anywhere; they snap to other nodes' edges and center lines, with guides. Positions are saved per note.
- **Export:** save the charts of a note as a single HTML file that anyone can open in a browser. It follows the viewer's light or dark mode.
- **Markdown inside nodes:** bold, code, links and wikilinks are shown as clean text.

## Syntax

````markdown
```flow
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

The syntax is compatible with [Flowchart Fun](https://flowchart.fun).

## Mobile

Works on phones and tablets. Charts inside code blocks are view-only on touch screens so the note scrolls normally; drag and edit in the side panel.

## Data

Node positions are stored as JSON files in a vault folder (`流程图位置` by default, configurable). Nothing is sent over the network.

## License

GPL-3.0. Third-party libraries: see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

---

## 中文说明

把缩进大纲画成思维导图或流程图，就在笔记里。还能直接在图上用回车、Tab 改大纲。

### 功能

- **写大纲就出图**：放在 `flow` 代码块里；或者打开侧栏，整篇笔记的标题和列表直接画成一张图。
- **四种结构**：思维导图、逻辑图（往右）、组织结构图（往下）、放射图。
- **在图上改**：点一下节点，回车加同级、Tab 加下级、Shift+Tab 提一级、空格或 F2 改字、Delete 连下级一起删，改动写回笔记。⌘Z / ⌘⇧Z（Ctrl+Z / Ctrl+Y）撤回、重做。
- **主题**：17 套，分「分支配色」和「单色」两组。
- **链接**：按住 ⌘ 或 Ctrl 单击节点，打开网址或 `[[笔记]]`。
- **回指**：写 `(名字)` 连回前面的节点；顺着写一串又回到开头的（比如五行），自动摆成正多边形。
- **概要**：`}` 一行用大括号把上面的兄弟括起来。
- **备注**：`【】` 里的字显示在节点下方，可以收起。
- **拖动和吸附**：拖节点时贴到别的节点的边和中线上，有参考线；位置按笔记保存。
- **导出网页**：把一篇笔记里的图存成一个 HTML 文件，发给别人用浏览器就能看，跟着对方系统的深浅色。
- **节点里的 Markdown**：加粗、代码、链接、双链都显示成干净的文字。

### 手机

手机、平板上能正常用。笔记里代码块的图在触屏上只用来看，手指滑动直接翻笔记；要拖、要改，去侧栏的图上操作。

### 数据

拖过的位置存在库里的 `流程图位置` 文件夹（设置里可以改），一篇笔记一个 JSON 文件。不联网，不上传任何东西。

### 许可

GPL-3.0。用到的第三方库见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
