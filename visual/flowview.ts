// FlowView 的冒烟测试：真的把类实例化出来，走 load → update → 出错 → 空 → 恢复。
// 这块逻辑在 Obsidian 外跑不了，但它正是这轮改动风险最高的地方（销毁重建改成就地更新）。
import { MarkdownView, TFile } from "obsidian";
import OutlineFlowPlugin, { FlowView } from "../src/main";
import { extractOutlineFromMarkdown } from "../src/graph";
import { applyEdit } from "../src/edit";
import { setLang, getLang } from "../src/i18n";

const results: string[] = [];
const ok = (name: string, cond: boolean, extra = "") => {
  results.push(`${cond ? "ok  " : "FAIL"} ${name}${extra ? "  " + extra : ""}`);
};

const settings = { folder: "流程图位置", theme: "card", direction: "LR", line: "poly", structure: "logic", snap: true, height: 420 };

// 用真的插件对象（改笔记、撤回栈、改完选中都是它管），只把 Obsidian 的 app 换成假的：
// 笔记全文存在 vaultText 里，没有打开的编辑器，所以走 vault.process 这条路。
let vaultText = "";
const noteFile = new TFile();
(noteFile as any).path = "n.md";
const openedNotes: unknown[][] = [];
const fakeApp: any = {
  vault: {
    getAbstractFileByPath: () => noteFile,
    process: async (_f: unknown, fn: (d: string) => string) => (vaultText = fn(vaultText)),
    cachedRead: async () => vaultText,
    adapter: { exists: async () => true, read: async () => "", write: async () => {}, mkdir: async () => {} },
  },
  workspace: { getLeavesOfType: () => [], openLinkText: (...a: unknown[]) => void openedNotes.push(a) },
};
const plugin: any = new OutlineFlowPlugin(fakeApp, {} as any);
plugin.settings = settings;

const host = document.getElementById("host")!;
const note = { version: 1 as const, diagrams: {} };

function make(source: string, opts: { readonly?: boolean; title?: string } = {}) {
  const el = document.createElement("div");
  host.appendChild(el);
  const v = new FlowView(el, plugin, source, opts.readonly ? null : "t.md", "0", opts.readonly ? ({ version: 1, diagrams: {} } as any) : (note as any), opts);
  v.load();
  return { v, el };
}

const cyOf = (v: any) => v.cy;
const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms));
const isMac = /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);
const MOD = isMac ? { metaKey: true } : { ctrlKey: true };
const press = (target: EventTarget, init: KeyboardEventInit) => {
  const e = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
};
const wheelOn = (target: EventTarget, init: WheelEventInit, deltaYLegacy?: number) => {
  const e = new WheelEvent("wheel", { bubbles: true, cancelable: true, ...init });
  if (deltaYLegacy !== undefined) Object.defineProperty(e, "wheelDeltaY", { value: deltaYLegacy }); // 鼠标滚轮一格 120
  target.dispatchEvent(e);
  return e;
};
/** ⌘（Windows / Linux 是 Ctrl）+ 点：cytoscape 的 tap 事件带着原始鼠标事件 */
const tapMod = (n: any) => n.emit({ type: "tap", originalEvent: { ...MOD } });
const mainCount = (v: any) => cyOf(v).nodes().not(".note").not(".summary").not(".summary-anchor").length;
const overlayShown = (el: HTMLElement) => {
  const o = el.querySelector(".outline-flow-overlay") as HTMLElement | null;
  return !!o && o.style.display !== "none" && o.textContent !== "";
};
const overlayText = (el: HTMLElement) => (el.querySelector(".outline-flow-overlay") as HTMLElement | null)?.textContent ?? "";

const run = async () => {
try {
  // 1. 正常内容
  const { v, el } = make("A\n  B\n  C\n  } 两个\n");
  // 概要「两个」现在是一个真节点，所以是 A、B、C 加它，一共 4 个
  ok("建图：4 个节点（含概要）", mainCount(v) === 4, `实际 ${mainCount(v)}`);
  ok("建图：概要是虚线框的那种节点", cyOf(v).nodes(".summary-node").length === 1);
  const cyId = cyOf(v).container() && cyOf(v).nodes().length;
  ok("建图：画布实例存在", !!cyOf(v));
  ok("建图：锚点也在", cyOf(v).nodes(".summary-anchor").length === 2, `实际 ${cyOf(v).nodes(".summary-anchor").length}`);
  const sameCy = cyOf(v);

  // 2. 就地更新（这轮改的核心路径）：换内容后还是同一个 cytoscape 实例
  v.update("A\n  B\n  C\n  D\n  } 三个\n");
  ok("更新：cytoscape 实例被复用，没有销毁重建", cyOf(v) === sameCy);
  ok("更新：节点数变成 5（含概要）", mainCount(v) === 5, `实际 ${mainCount(v)}`);
  ok("更新：旧锚点清掉了，只剩新的一对", cyOf(v).nodes(".summary-anchor").length === 2, `实际 ${cyOf(v).nodes(".summary-anchor").length}`);
  ok("更新：没有重复 id", cyOf(v).nodes().length === new Set(cyOf(v).nodes().map((n: any) => n.id())).size);

  // 3. 以前会整张报错的写法（顶层「A (B): C」）：现在当普通字画出来，不盖错误提示
  let threw = "";
  try {
    v.update("A (B): C\n");
  } catch (e: any) {
    threw = e?.message ?? String(e);
  }
  ok("写法读不通：不抛异常到外面", threw === "", threw);
  ok("写法读不通：按原文画成一个节点", mainCount(v) === 1 && cyOf(v).nodes().first().data("label") === "A (B): C", `实际 ${mainCount(v)}`);
  ok("写法读不通：不盖错误提示", !overlayShown(el), overlayText(el));

  // 4. 空内容
  v.update("");
  ok("空内容：节点清空", mainCount(v) === 0, `实际 ${mainCount(v)}`);
  ok("空内容：给出提示", overlayShown(el), overlayText(el).slice(0, 20));

  // 5. 从空恢复到有内容，提示要收起来
  v.update("X\n  Y\n");
  ok("恢复：节点回来了", mainCount(v) === 2, `实际 ${mainCount(v)}`);
  ok("恢复：提示收起来了", !overlayShown(el), overlayText(el));

  // 6. 备注开关：内容变了以后按钮要跟着出现/消失
  const noteBtn = (v as any).notesBtn as HTMLElement;
  ok("备注：没有备注时按钮隐藏", noteBtn.style.display === "none", `display=${noteBtn.style.display}`);
  v.update("X【有备注了】\n  Y\n");
  ok("备注：有备注时按钮出现", noteBtn.style.display !== "none", `display=${noteBtn.style.display}`);

  // 6b. 单独开关：点一下备注收起成「···」，再点展开；备注始终在节点正下方
  {
    const cy = cyOf(v);
    const noteOf = () => cy.nodes(".note").first();
    const owner = cy.nodes().filter((n: any) => n.data("label") === "X").first();
    ok("备注：在节点正下方", Math.abs(noteOf().position("x") - owner.position("x")) < 0.5 && noteOf().position("y") > owner.position("y"));
    noteOf().emit("tap");
    ok("备注：点一下收起成三个点", noteOf().data("label") === "···" && noteOf().hasClass("folded"), noteOf().data("label"));
    ok("备注：收起的状态记下来了", ((note.diagrams as any)["0"]?.notesFolded ?? []).includes("X"));
    noteOf().emit("tap");
    ok("备注：再点一下展开", noteOf().data("label") === "有备注了", noteOf().data("label"));
  }

  // 7. 重复喂同一份内容不应该有任何动作
  const before = mainCount(v);
  v.update("X【有备注了】\n  Y\n");
  ok("重复内容：直接跳过", mainCount(v) === before);

  // 8. 换结构：只剩四种；方向、线型不再单独选；归档的结构按思维导图画
  const s = make("根\n  甲\n    甲一\n    甲二\n  乙\n");
  const structPicker = (s.v as any).structurePicker;
  const themePicker = (s.v as any).themePicker;
  const pick = (p: any, v: string) => p.pick(v);
  structPicker.button.click();
  const pop = () => s.el.querySelector(".outline-flow-picker-pop");
  ok("结构：点按钮弹出整张列表，只有 4 种", !!pop() && [...pop()!.querySelectorAll(".outline-flow-picker-item")].map((x) => x.textContent).join() === "思维导图,逻辑图,组织结构图,放射图", pop()?.textContent ?? "");
  ok("结构：列表里标出当前的（测试设置是逻辑图）", pop()?.querySelector(".is-current")?.textContent === "逻辑图");
  document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  ok("结构：点别处收起", !pop());
  plugin.settings.newStyle = "last";
  plugin.saveSettings = async () => {};
  themePicker.button.click();
  ok("主题：分两组，每项带色块", [...s.el.querySelectorAll(".outline-flow-picker-group")].map((x) => x.textContent).join() === "分支配色,单色" && s.el.querySelectorAll(".outline-flow-picker-pop .outline-flow-swatch").length > 10);
  (s.el.querySelectorAll(".outline-flow-picker-item")[0] as HTMLElement).click();
  ok("默认样式：选「跟上一张图一样」时，在图上换的主题成了新图的默认", plugin.settings.theme === "colorful");
  plugin.settings.newStyle = "fixed";
  plugin.settings.theme = "card";
  ok("主题：点一项就换上、列表收起", (s.v as any).data.theme === "colorful" && !pop());
  ok("结构：工具条上没有下拉框了", s.el.querySelectorAll(".outline-flow-bar select").length === 0);
  ok("结构：有 4 条连线", cyOf(s.v).edges().not(".summary").length === 4);
  for (const k of ["logic", "org", "radial", "mindmap"]) {
    pick(structPicker, k);
    ok(`结构：换成${k}后节点、连线都在`, mainCount(s.v) === 5 && cyOf(s.v).edges().not(".summary").length === 4, `${mainCount(s.v)}`);
  }
  ok("结构：换结构后没有重复 id", cyOf(s.v).nodes().length === new Set(cyOf(s.v).nodes().map((n: any) => n.id())).size);
  {
    // 以前存成鱼骨图、主干图的：按思维导图画，存着的值不动
    const old = { version: 1 as const, diagrams: { "0": { pos: {}, structure: "fishbone" } } };
    const el = document.createElement("div");
    host.appendChild(el);
    const ov = new FlowView(el, plugin, "根\n  甲\n  乙\n", "old.md", "0", old as any, {});
    ov.load();
    ok("结构：归档的结构按思维导图画，存着的值不改", (ov as any).structure === "mindmap" && old.diagrams["0"].structure === "fishbone" && cyOf(ov).edges(".spine").length === 0);
    ov.unload();
  }

  // 8a. 关联靠近：有虚线才出现；点一下记进数据、按钮亮起；没虚线的图不显示（每张图用自己的数据，测完拿掉，免得挤动后面的图）
  {
    const own = (src: string) => {
      const el = document.createElement("div");
      host.appendChild(el);
      const v: any = new FlowView(el, plugin, src, "near.md", "0", { version: 1, diagrams: {} } as any, {});
      v.load();
      const btn = [...el.querySelectorAll(".outline-flow-bar button")].find((b) => b.textContent === "关联靠近") as HTMLButtonElement;
      return { v, el, btn };
    };
    const r = own("根\n  甲\n    甲1\n  乙\n  丙\n  丁\n    丁1: (甲1)\n");
    ok("关联靠近：有虚线时按钮在", !!r.btn && r.btn.style.display !== "none");
    r.btn.click();
    ok("关联靠近：点一下打开、记进数据、按钮亮起", r.v.data.nearRefs === true && r.btn.classList.contains("is-active"));
    const plain = own("根\n  甲\n  乙\n");
    ok("关联靠近：没有虚线的图不显示按钮", plain.btn.style.display === "none");
    for (const x of [r, plain]) {
      x.v.unload();
      x.el.remove();
    }
  }

  // 8a2. 焦点：拖完松开时，焦点被别处抢走了也要回到图上
  {
    const el = document.createElement("div");
    host.appendChild(el);
    const v: any = new FlowView(el, plugin, "根\n  甲\n", "focus.md", "0", { version: 1, diagrams: {} } as any, {});
    v.load();
    const stage = el.querySelector(".outline-flow-stage") as HTMLElement;
    const other = document.createElement("button");
    host.appendChild(other);
    stage.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    ok("焦点：按下画布图就拿到焦点", document.activeElement === stage);
    other.focus(); // 模拟拖动过程中被编辑器抢走
    stage.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    await sleep(5);
    ok("焦点：在画布里松开，焦点回到图上", document.activeElement === stage);
    v.unload();
    el.remove();
    other.remove();
  }

  // 8a3. 「图在用」：拖动中焦点被抢不算退出（边框不闪）；点工具条按钮也算在用；点到外面才退出
  {
    const el = document.createElement("div");
    host.appendChild(el);
    const v: any = new FlowView(el, plugin, "根\n  甲\n", "active.md", "0", { version: 1, diagrams: {} } as any, {});
    v.load();
    const stage = el.querySelector(".outline-flow-stage") as HTMLElement;
    const other = document.createElement("button");
    host.appendChild(other);
    stage.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    other.focus(); // 拖动中被别处抢走焦点
    ok("在用：按着鼠标时焦点被抢，边框不掉", el.classList.contains("is-active"));
    window.dispatchEvent(new MouseEvent("mouseup"));
    await sleep(5);
    ok("在用：松开后焦点回到画布", document.activeElement === stage && el.classList.contains("is-active"));
    other.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    ok("在用：点到图外面就退出", !el.classList.contains("is-active"));
    const btn = el.querySelector(".outline-flow-bar button") as HTMLElement;
    btn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    window.dispatchEvent(new MouseEvent("mouseup"));
    await sleep(5);
    ok("在用：点工具条上的菜单按钮也算在用，焦点回到画布", el.classList.contains("is-active") && document.activeElement === stage);
    const w = new WheelEvent("wheel", { deltaY: 100, cancelable: true, bubbles: true });
    stage.dispatchEvent(w);
    ok("在用：点完菜单按钮，滚轮直接就是缩放", w.defaultPrevented);
    v.unload();
    el.remove();
    other.remove();
  }

  // 8a4. 吸附开关和参考线
  {
    const el = document.createElement("div");
    host.appendChild(el);
    const v: any = new FlowView(el, plugin, "根\n  甲\n  乙\n", "snap.md", "0", { version: 1, diagrams: {} } as any, {});
    v.load();
    plugin.saveSettings = async () => {};
    const btn = [...el.querySelectorAll(".outline-flow-bar button")].find((b) => b.textContent === "吸附") as HTMLButtonElement;
    const was = !!plugin.settings.snap;
    btn.click();
    ok("吸附：工具条按钮能开关，按钮跟着亮灭", !!plugin.settings.snap === !was && btn.classList.contains("is-active") === !was);
    plugin.settings.snap = true;
    const cy = v.cy;
    const jia = cy.nodes().filter((n: any) => n.data("label") === "甲").first();
    const yi = cy.nodes().filter((n: any) => n.data("label") === "乙").first();
    jia.position({ x: yi.position("x") + 5, y: yi.position("y") + 200 });
    jia.emit("drag");
    const guide = el.querySelector(".outline-flow-guide.is-v") as HTMLElement;
    ok("吸附：拖到差几像素的地方出现竖的参考线", guide.style.display !== "none");
    jia.emit("dragfree");
    ok("吸附：松手贴到乙的中线上，参考线收起", Math.abs(jia.position("x") - yi.position("x")) < 1 && guide.style.display === "none");
    // 拖到和父节点（根）差几像素的高度：松手后正好在同一高度，不差半个像素（差一点折线就会多一个小拐弯）
    const root = cy.nodes().filter((n: any) => n.data("label") === "根").first();
    jia.position({ x: root.position("x") + 260, y: root.position("y") + 6.3 });
    jia.emit("drag");
    jia.emit("dragfree");
    ok("吸附：和父节点对齐后高度完全一样，线是直的", jia.position("y") === root.position("y"), `${jia.position("y")} vs ${root.position("y")}`);
    v.unload();
    el.remove();
  }

  // 8b. 某一行读不通：图照样出来，图下面列出那一行，带「去这一行」
  {
    const bad = make("根\n  甲 #a\n  乙 #a\n");
    ok("读不通的行：图照样出来", mainCount(bad.v) === 3, `实际 ${mainCount(bad.v)}`);
    const w = bad.el.querySelector(".outline-flow-warning");
    ok("读不通的行：图下面说了是哪一行", !!w && (w.textContent ?? "").includes("乙 #a"), w?.textContent ?? "");
    ok("读不通的行：带「去这一行」", !!bad.el.querySelector(".outline-flow-goto"));
  }

  // 8c. 网址：一个直接打开，几个弹菜单
  {
    const opened: unknown[][] = [];
    const realOpen = window.open;
    window.open = ((...a: unknown[]) => (opened.push(a), null)) as any;
    const L = make("根\n  官网 https://a.com/p#x\n  两处 [甲](https://j.com) [乙](https://y.com)\n  普通\n");
    const cy = cyOf(L.v);
    const one = cy.nodes(".link").filter((n: any) => n.data("label").startsWith("官网")).first();
    const two = cy.nodes(".link").filter((n: any) => n.data("label").startsWith("两处")).first();
    const plain = cy.nodes().filter((n: any) => n.data("label") === "普通").first();
    ok("网址：只有带网址的两个节点有 link 类", cy.nodes(".link").length === 2, `实际 ${cy.nodes(".link").length}`);
    ok("网址：节点文字是完整的地址", one.data("label") === "官网 https://a.com/p#x", one.data("label"));

    one.emit("tap");
    ok("网址：插件里单击只是选中，不会打开", opened.length === 0 && (L.v as any).selected === one, JSON.stringify(opened));
    tapMod(one);
    ok("网址：一个地址，⌘+单击直接新标签页打开", opened.length === 1 && opened[0][0] === "https://a.com/p#x" && opened[0][1] === "_blank" && opened[0][2] === "noopener", JSON.stringify(opened));
    ok("网址：一个地址不弹菜单", !L.el.querySelector(".outline-flow-linkmenu"));
    plain.emit("tap");
    ok("网址：没网址的节点点了不打开", opened.length === 1);

    tapMod(two);
    const menu = L.el.querySelector(".outline-flow-linkmenu") as HTMLElement | null;
    ok("网址：两个地址，弹出菜单", !!menu);
    ok("网址：菜单里两个链接", menu?.querySelectorAll("a").length === 2, `实际 ${menu?.querySelectorAll("a").length}`);
    const a0 = menu?.querySelector("a") as HTMLAnchorElement | null;
    ok("网址：链接在新标签页打开、带 noopener", a0?.getAttribute("href") === "https://j.com" && a0.getAttribute("target") === "_blank" && a0.getAttribute("rel") === "noopener");
    ok("网址：链接上有字，第二行是地址", a0?.querySelector("span")?.textContent === "甲" && a0?.querySelector("small")?.textContent === "https://j.com");
    ok("网址：点两个地址的节点没有直接打开", opened.length === 1);
    {
      // 菜单在节点正下方（屏幕位置）
      const at = two.renderedPosition();
      const top = parseFloat(menu!.style.top);
      ok("网址：菜单摆在节点下面", Math.abs(parseFloat(menu!.style.left) + menu!.offsetWidth / 2 - at.x) < 1 || parseFloat(menu!.style.left) <= 6 || top >= at.y, `left=${menu!.style.left} top=${menu!.style.top} node=${at.x.toFixed(0)},${at.y.toFixed(0)}`);
    }
    cy.emit("tap"); // 点背景
    ok("网址：点背景收起菜单", !L.el.querySelector(".outline-flow-linkmenu"));
    tapMod(two);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    ok("网址：按 Esc 收起菜单", !L.el.querySelector(".outline-flow-linkmenu"));
    tapMod(two);
    plain.emit("tap");
    ok("网址：点别的节点也收起菜单", !L.el.querySelector(".outline-flow-linkmenu"));

    const stage = L.el.querySelector(".outline-flow-stage") as HTMLElement;
    const tip = L.el.querySelector(".outline-flow-linktip") as HTMLElement;
    ok("网址：地址条平时是藏着的", tip.style.display === "none");
    two.emit("mouseover");
    ok("网址：插件里鼠标移上去，指针不变手形（单击是选中）", stage.style.cursor === "");
    ok("网址：鼠标移上去，条里写明怎么打开并显示全部地址", tip.style.display !== "none" && tip.textContent === `${isMac ? "⌘" : "Ctrl"}+单击打开：https://j.com  ·  https://y.com`, tip.textContent ?? "");
    two.emit("mouseout");
    ok("网址：鼠标移开，条藏起来", tip.style.display === "none" && stage.style.cursor === "");
    window.open = realOpen;
    ok("工具条：有「导出网页」按钮", Array.from(L.el.querySelectorAll(".outline-flow-bar button")).some((b) => b.textContent === "导出网页"));

    // 真的鼠标事件：拖动节点松手不算点击；原地按下抬起才算
    const opened2: unknown[][] = [];
    window.open = ((...a: unknown[]) => (opened2.push(a), null)) as any;
    const stageEl = L.el.querySelector(".outline-flow-stage") as HTMLElement;
    stageEl.style.height = "420px";
    cy.resize();
    const box = stageEl.getBoundingClientRect();
    const mouse = (type: string, target: EventTarget, x: number, y: number, mod = false) =>
      target.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, button: 0, buttons: type === "mouseup" ? 0 : 1, bubbles: true, cancelable: true, ...(mod ? MOD : {}) }));
    const pos = one.renderedPosition();
    const px = box.left + pos.x;
    const py = box.top + pos.y;
    const before = { ...one.position() };
    mouse("mousedown", stageEl.querySelector("canvas")!, px, py);
    mouse("mousemove", window, px + 30, py + 30);
    mouse("mousemove", window, px + 60, py + 60);
    mouse("mouseup", window, px + 60, py + 60);
    const moved = Math.abs(one.position().x - before.x) + Math.abs(one.position().y - before.y) > 5;
    ok("网址：真的拖动了节点（前提）", moved, `位置 ${before.x.toFixed(0)},${before.y.toFixed(0)} -> ${one.position().x.toFixed(0)},${one.position().y.toFixed(0)}`);
    ok("网址：拖动节点松手，不会打开网址", opened2.length === 0, JSON.stringify(opened2));
    ok("网址：拖动的节点被选中", (L.v as any).selected === one);
    ok("网址：拖动记进撤回栈", plugin.history(plugin.viewportKey("t.md", "0")).undo.length >= 1);
    const pos2 = one.renderedPosition();
    mouse("mousedown", stageEl.querySelector("canvas")!, box.left + pos2.x, box.top + pos2.y);
    mouse("mouseup", window, box.left + pos2.x, box.top + pos2.y);
    ok("网址：原地单击（没按 ⌘）只是选中，不打开", opened2.length === 0 && (L.v as any).selected === one, JSON.stringify(opened2) + " sel=" + (L.v as any).selected?.data("label") + " one=" + one.data("label") + " rm=" + one.removed() + " focus=" + document.activeElement?.className);
    mouse("mousedown", stageEl.querySelector("canvas")!, box.left + pos2.x, box.top + pos2.y, true);
    mouse("mouseup", window, box.left + pos2.x, box.top + pos2.y, true);
    ok("网址：原地 ⌘+单击，才算点击打开", opened2.length === 1, JSON.stringify(opened2));
    window.open = realOpen;
  }

  // 8d. 只读（导出网页用）：没有工具条的下拉，节点不能拖，不存东西
  {
    const R = make("根\n  甲【有备注】\n  乙 https://a.com\n", { readonly: true, title: "安装和启动" });
    const cy = cyOf(R.v);
    ok("只读：没有下拉框", R.el.querySelectorAll("select").length === 0);
    ok("只读：没有「重新自动排版」「复制」「导出网页」按钮", !Array.from(R.el.querySelectorAll("button")).some((b) => /排版|复制|导出/.test(b.textContent ?? "")));
    const btns = Array.from(R.el.querySelectorAll(".outline-flow-head button")).map((b) => b.textContent);
    ok("只读：标题条左边是图名，右边两个按钮", R.el.querySelector(".outline-flow-title")?.textContent === "安装和启动" && btns.join() === "适应窗口,全屏", btns.join());
    ok("只读：节点都不能拖", cy.nodes().length > 0 && cy.nodes().every((n: any) => !n.grabbable()));
    ok("只读：状态行不画", !R.el.querySelector(".outline-flow-status") && !R.el.querySelector(".outline-flow-warning"));
    const hint = R.el.querySelector(".outline-flow-hint")?.textContent ?? "";
    ok("只读：右下角的操作提示", /^拖动平移 · 按住 (⌘|Ctrl) 滚动缩放$/.test(hint), hint);
    const h = parseFloat((R.el.querySelector(".outline-flow-stage") as HTMLElement).style.height);
    ok("只读：图的高度按图量过，在 240 到 80vh 之间", h >= 240 && h <= Math.max(240, window.innerHeight * 0.8), `高度 ${h}`);
    // 点备注：照样折叠，但不存
    cy.nodes(".note").first().emit("tap");
    const folded = cy.nodes(".note").first(); // 折叠会重建备注节点，要重新取
    ok("只读：点备注能折叠", folded.data("label") === "···", folded.data("label"));
    ok("只读：折叠不排保存", (R.v as any).saveTimer === null);
    // 带网址的节点照样能点
    const opened: unknown[][] = [];
    const realOpen = window.open;
    window.open = ((...a: unknown[]) => (opened.push(a), null)) as any;
    cy.nodes(".link").first().emit("tap");
    window.open = realOpen;
    ok("只读：网址照样能点开", opened.length === 1 && opened[0][0] === "https://a.com");
    // 滚轮：图没有焦点、不按 Cmd/Ctrl 时不拦截（让页面滚动）。上面点节点会让图拿到焦点，先放开
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); // 点到图外面
    const wheel = new WheelEvent("wheel", { deltaY: 100, cancelable: true, bubbles: true });
    (R.el.querySelector(".outline-flow-stage") as HTMLElement).dispatchEvent(wheel);
    ok("只读：普通滚轮不拦截，页面照常滚", wheel.defaultPrevented === false);
    // 全屏：无头浏览器不给真全屏，这里伪造 fullscreenElement 再发 fullscreenchange，看进出两头的处理
    {
      const stage = R.el.querySelector(".outline-flow-stage") as HTMLElement;
      const before = stage.style.height;
      Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => R.el });
      R.el.dispatchEvent(new Event("fullscreenchange"));
      ok("只读：进全屏后图撑满（高度交给样式、按钮变「退出全屏」）", stage.style.height === "" && R.el.classList.contains("is-fill") && R.el.querySelector(".outline-flow-head button:last-child")?.textContent === "退出全屏");
      Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => null });
      R.el.dispatchEvent(new Event("fullscreenchange"));
      ok("只读：退出全屏后按图的比例重新定高", stage.style.height === before && !R.el.classList.contains("is-fill") && R.el.querySelector(".outline-flow-head button:last-child")?.textContent === "全屏", `${before} -> ${stage.style.height}`);
      delete (document as any).fullscreenElement;
    }
    // 主题换了能就地跟上（网页跟系统深浅色用的就是这条路）
    ((R.v as any).data as any).theme = "dark";
    R.v.syncFromData();
    ok("只读：换主题后画布底色跟着变", (R.el.querySelector(".outline-flow-stage") as HTMLElement).style.background.includes("20, 23, 28"), (R.el.querySelector(".outline-flow-stage") as HTMLElement).style.background);
  }

  // 8e. 只读里的双链不是链接；点图拿到焦点；滚轮规则
  {
    const R = make("根\n  去 [[某笔记|别名]]\n  官网 https://a.com\n", { readonly: true, title: "t" });
    const cy = cyOf(R.v);
    const wiki = cy.nodes().filter((n: any) => n.data("label") === "去 别名").first();
    ok("只读：双链当普通文字，没有链接色", wiki.data("links") === undefined && !wiki.hasClass("link"));
    const stage = R.el.querySelector(".outline-flow-stage") as HTMLElement;
    const hint = R.el.querySelector(".outline-flow-hint") as HTMLElement;
    ok("只读：图能拿到焦点（tabindex）", stage.getAttribute("tabindex") === "0");
    (document.activeElement as HTMLElement | null)?.blur();
    const z0 = cy.zoom();
    const plainWheel = wheelOn(stage, { deltaY: 100 }, -120);
    ok("只读：没焦点时普通滚轮不缩放、不拦截", !plainWheel.defaultPrevented && cy.zoom() === z0);
    cy.emit("tap"); // 点背景，图拿到焦点
    ok("只读：点图之后焦点在图上", document.activeElement === stage);
    ok("只读：焦点在图上时提示变成滚轮缩放、双指平移", /滚轮 缩放/.test(hint.textContent ?? ""), hint.textContent ?? "");
    const mouseWheel = wheelOn(stage, { deltaY: 100, clientX: 400, clientY: 300 }, -120);
    ok("只读：有焦点时鼠标滚轮缩放（向下滚缩小）", mouseWheel.defaultPrevented && cy.zoom() < z0, `${z0.toFixed(3)} -> ${cy.zoom().toFixed(3)}`);
    const z1 = cy.zoom();
    let pan0 = { ...cy.pan() };
    const smooth = wheelOn(stage, { deltaY: 9 });
    ok("只读：有焦点时数值小的竖滚（Mac 平滑滚动的鼠标、触控板）也是缩放", smooth.defaultPrevented && cy.zoom() < z1, `${z1} -> ${cy.zoom()}`);
    cy.zoom(z1);
    pan0.x = cy.pan().x;
    pan0.y = cy.pan().y;
    const trackpad = wheelOn(stage, { deltaX: 20, deltaY: 3 });
    ok("只读：有焦点时明显横滑是横向平移、不缩放", trackpad.defaultPrevented && cy.zoom() === z1 && Math.abs(cy.pan().x - (pan0.x - 20)) < 0.01 && Math.abs(cy.pan().y - pan0.y) < 0.01, JSON.stringify(cy.pan()));
    const pan1 = { ...cy.pan() };
    wheelOn(stage, { deltaY: 100, shiftKey: true }, -120);
    ok("只读：Shift+鼠标滚轮横向平移", Math.abs(cy.pan().x - (pan1.x - 100)) < 0.01 && cy.pan().y === pan1.y && cy.zoom() === z1);
    wheelOn(stage, { deltaY: -4.5, ctrlKey: true });
    ok("只读：捏合（带小数的 Ctrl+滚轮）放大", cy.zoom() > z1);
    const zPinch = cy.zoom();
    press(stage, { key: "0", ...MOD });
    ok("只读：⌘0 适应窗口（缩放变了）", Math.abs(cy.zoom() - zPinch) > 1e-6, `${zPinch} -> ${cy.zoom()}`);
    const fitZoom = cy.zoom();
    wheelOn(stage, { deltaY: 100, ...MOD }, -120);
    ok("只读：⌘/Ctrl+滚轮照样缩放", cy.zoom() !== fitZoom);
    press(stage, { key: "0", ...MOD });
    ok("只读：⌘0 把缩放摆回适应窗口", Math.abs(cy.zoom() - fitZoom) < 0.0001, `${fitZoom} vs ${cy.zoom()}`);
    press(stage, { key: "Escape" });
    await sleep(0);
    ok("只读：Esc 放开焦点", document.activeElement !== stage);
    ok("只读：失去焦点后提示变回按住 ⌘ 缩放", /按住 (⌘|Ctrl) 滚动缩放/.test(hint.textContent ?? ""), hint.textContent ?? "");
    const after = wheelOn(stage, { deltaY: 100 }, -120);
    ok("只读：Esc 之后普通滚轮又不拦截", !after.defaultPrevented);
  }

  // 8f. 在图上选中、改字、加节点、删除（插件里的非只读图）
  {
    const note2 = { version: 1 as const, diagrams: {} };
    const el = document.createElement("div");
    host.appendChild(el);
    // 源文本里有：普通节点、带线上的字和备注的、概要
    const src = "根\n  甲\n    甲一\n  乙: 乙一【备注】\n  丙 https://a.com\n  } 两个\n";
    const E = new FlowView(el, plugin, src, "t.md", "e1", note2 as any);
    E.load();
    const v: any = E;
    const cy = cyOf(v);
    const stage = el.querySelector(".outline-flow-stage") as HTMLElement;
    const keysLine = () => (el.querySelector(".outline-flow-keys") as HTMLElement).textContent ?? "";
    const byLabel = (t: string) => cy.nodes().filter((n: any) => n.data("label") === t).first();
    const calls: any[] = [];
    const realEdit = plugin.editNode;
    let reply: any = { ok: true };
    plugin.editNode = (req: any) => (calls.push(req), Promise.resolve(reply));
    // 加节点前的预排：把源文本当成笔记里唯一的代码块，用真正写笔记的规则算
    plugin.previewEdit = async (req: any) => {
      const r: any = applyEdit("```flow\n" + req.source + "```\n", { mode: "block", index: 0 }, req.source, req.op);
      return r.ok ? { ok: true, source: r.source, srcLine: r.srcLine } : r;
    };
    const fresh = () => cy.nodes(".fresh");
    const parentLabel = (n: any) => n.incomers("edge").not(".ref").sources().first().data("label");
    const inputEl = () => el.querySelector("input.outline-flow-input") as HTMLInputElement | null;
    const toastText = () => (el.querySelector(".outline-flow-toast") as HTMLElement).textContent ?? "";
    const toastShown = () => (el.querySelector(".outline-flow-toast") as HTMLElement).style.display !== "none";

    ok("编辑：图能拿到焦点（tabindex=0）", stage.getAttribute("tabindex") === "0");
    // —— 选中 ——
    const jia = byLabel("甲");
    jia.emit("tap");
    ok("编辑：单击节点选中它，有 selected 类", v.selected === jia && jia.hasClass("selected"));
    ok("编辑：选中后图拿到焦点", document.activeElement === stage);
    ok("编辑：选中后提示行列出按键", keysLine().includes("回车 加同级 · Tab 加下级 · ⇧Tab 提一级 · ⌥↑↓ 上移下移 · 空格 改字 · Delete 删除") && keysLine().includes("右键 更多"), keysLine());
    ok("编辑：选中时外面描一圈轮廓线（跟着节点的圆角）", parseFloat(jia.style("outline-width")) > 0, `${jia.style("outline-width")}`);
    byLabel("乙一").emit("tap");
    ok("编辑：选另一个，前一个取消", !jia.hasClass("selected") && v.selected === byLabel("乙一"));
    cy.emit("tap");
    ok("编辑：点背景取消选中", v.selected === null && cy.nodes(".selected").length === 0);
    ok("编辑：点背景后提示行只剩焦点提示", keysLine() === "滚轮 缩放 · 拖空白处 平移", keysLine());
    cy.nodes(".summary-node").first().emit("tap");
    cy.nodes(".note").first().emit("tap");
    ok("编辑：概要节点、备注点了不会被选中", v.selected === null);
    const e0 = press(stage, { key: "Enter" });
    ok("编辑：没有选中节点时回车不动手", !inputEl() && !e0.defaultPrevented && calls.length === 0);

    // —— 回车加同级，Esc 取消 ——
    jia.emit("tap");
    const enter = press(stage, { key: "Enter" });
    await sleep(5);
    ok("编辑：回车拦下了按键（不传给编辑器）", enter.defaultPrevented);
    ok("编辑：回车后新节点直接出现、输入框拿到焦点", fresh().length === 1 && !!inputEl() && document.activeElement === inputEl());
    ok("编辑：新节点按最终位置排好：在甲整棵子树下面、和甲同一列", fresh().first().position("y") > byLabel("甲一").position("y") && Math.abs(fresh().first().position("x") - byLabel("甲").position("x")) < 1);
    ok("编辑：新节点一出来就连着线（从根连过来）", parentLabel(fresh().first()) === "根");
    ok("编辑：新节点是真节点，参与排版", v.mainNodes().filter((n: any) => n.hasClass("fresh")).length === 1);
    ok("编辑：输入框盖在临时节点上", (() => {
      const i = inputEl()!;
      const n = fresh().first();
      const p = n.renderedPosition();
      return Math.abs(parseFloat(i.style.left) - (p.x - n.renderedOuterWidth() / 2)) < 1 && Math.abs(parseFloat(i.style.width) - n.renderedOuterWidth()) < 1;
    })());
    ok("编辑：输入时提示行变成回车确定 / Esc 取消", keysLine() === "回车 确定 · Esc 取消", keysLine());
    {
      const i = inputEl()!;
      const w0 = parseFloat(i.style.width);
      i.value = "一段相当长的新节点文字内容";
      i.dispatchEvent(new Event("input"));
      ok("编辑：打字时节点和输入框跟着变宽", parseFloat(i.style.width) > w0, `${w0} -> ${i.style.width}`);
      // 缩放时输入框跟着画面
      const f0 = parseFloat(i.style.fontSize);
      cy.zoom({ level: cy.zoom() * 1.5, renderedPosition: { x: 10, y: 10 } });
      ok("编辑：画面缩放时输入框的字号跟着变", Math.abs(parseFloat(i.style.fontSize) / f0 - 1.5) < 0.01, `${f0} -> ${i.style.fontSize}`);
      const x = press(i, { key: "Escape" });
      ok("编辑：Esc 取消：输入框和新节点都没了，没有写笔记", x.defaultPrevented && !inputEl() && fresh().length === 0 && v.mainNodes().length === 6 && calls.length === 0, `${v.mainNodes().length}`);
      ok("编辑：Esc 取消后焦点回到图、选中还在甲", document.activeElement === stage && v.selected?.data("label") === "甲");
    }

    // —— 空字 = 取消；输入法选字中的回车不算 ——
    press(stage, { key: "Enter" });
    await sleep(5);
    press(inputEl()!, { key: "Enter", isComposing: true });
    ok("编辑：输入法选字中按回车不提交", !!inputEl() && calls.length === 0);
    inputEl()!.value = "   ";
    press(inputEl()!, { key: "Enter" });
    ok("编辑：空字回车 = 取消，什么都不写", !inputEl() && fresh().length === 0 && calls.length === 0);

    // —— Tab 加下级，打字，回车提交 ——
    press(stage, { key: "Tab" });
    await sleep(5);
    ok("编辑：Tab 造出新节点和输入框，连在甲下面", !!inputEl() && fresh().length === 1 && parentLabel(fresh().first()) === "甲");
    ok("编辑：下级新节点排在甲一的下面（甲已有子节点）", fresh().first().position("y") > byLabel("甲一").position("y"));
    ok("编辑：新节点不压在别的节点上", (() => {
      const t = fresh().first().boundingBox();
      return v.mainNodes().not(".fresh").every((o: any) => { const b = o.boundingBox(); return t.x2 <= b.x1 || t.x1 >= b.x2 || t.y2 <= b.y1 || t.y1 >= b.y2; });
    })());
    inputEl()!.value = " 新下级 ";
    inputEl()!.dispatchEvent(new Event("input"));
    press(inputEl()!, { key: "Enter" });
    await sleep(0);
    ok("编辑：回车提交：交给插件写笔记，字去掉首尾空白", calls.length === 1 && calls[0].op.kind === "addChild" && calls[0].op.text === "新下级" && calls[0].op.line === jia.data("line") && calls[0].notePath === "t.md" && calls[0].diagramId === "e1", JSON.stringify(calls));
    ok("编辑：提交后输入框没了，焦点回到图", !inputEl() && document.activeElement === stage);
    ok("编辑：等图重画期间新节点显示打的字", cy.nodes().filter((n: any) => n.data("label") === "新下级").length === 1);
    press(stage, { key: "Delete" });
    ok("编辑：等图重画期间按键不再动手", calls.length === 1);
    // 重画（侧栏就地更新 / 代码块换新视图都会走到 applySource）：临时节点、等待状态都清掉
    v.update(src + "  新下级\n");
    ok("编辑：图重画后可以继续按键", fresh().length === 0 && v.busy === false);

    // —— Tab 在没选中节点时不拦截；回车 + blur 提交，且不抢焦点 ——
    const jia2 = byLabel("甲");
    jia2.emit("tap");
    press(stage, { key: "Enter" });
    await sleep(5);
    inputEl()!.value = "同级新";
    inputEl()!.dispatchEvent(new Event("input"));
    const other = document.createElement("button");
    host.appendChild(other);
    other.focus();
    inputEl()?.dispatchEvent(new FocusEvent("blur"));
    await sleep(0);
    ok("编辑：点别处（失焦）也提交，而且不把焦点抢回来", calls.length === 2 && calls[1].op.kind === "addSibling" && calls[1].op.text === "同级新" && document.activeElement === other, JSON.stringify(calls[1]?.op));
    other.remove();
    v.update(src + "  新下级2\n");

    // —— 改字：空格 / F2 / 双击 ——
    plugin.nodeText = async (req: any) => (calls.push({ read: req.line }), req.line === 4 ? "乙一" : "原文 **粗**");
    const yi = byLabel("乙一");
    yi.emit("tap");
    press(stage, { key: " " });
    await sleep(0);
    ok("编辑：空格进入改字，输入框里是节点原文（不含线上的字和备注）", !!inputEl() && inputEl()!.value === "乙一", inputEl()?.value);
    ok("编辑：改字时节点原来的字被盖住（editing 类）", yi.hasClass("editing"));
    press(inputEl()!, { key: "Escape" });
    ok("编辑：改字时 Esc：还原原来的字，不写", !inputEl() && yi.data("label") === "乙一" && !yi.hasClass("editing") && !calls.some((c) => c.op?.kind === "setText"));
    const nCalls = calls.length;
    press(stage, { key: "F2" });
    await sleep(0);
    press(inputEl()!, { key: "Enter" });
    await sleep(0);
    ok("编辑：字没变不写", calls.length === nCalls + 1 /* 只多了读原文那一次 */ && !calls.some((c) => c.op?.kind === "setText"));
    byLabel("乙一").emit("dbltap");
    await sleep(0);
    ok("编辑：双击也进入改字", !!inputEl());
    inputEl()!.value = "改过的";
    press(inputEl()!, { key: "Enter" });
    await sleep(0);
    ok("编辑：改字提交：setText，行号是节点自己的行", calls.some((c) => c.op?.kind === "setText" && c.op.text === "改过的" && c.op.line === 4), JSON.stringify(calls.at(-1)));
    v.update(src + "  改过的\n");

    // —— Delete / Backspace / Shift+Tab ——
    const jia3 = byLabel("甲");
    jia3.emit("tap");
    const del = press(stage, { key: "Delete" });
    await sleep(0);
    ok("编辑：Delete 删除：拦下按键，交给插件，带上节点行号", del.defaultPrevented && calls.at(-1).op.kind === "remove" && calls.at(-1).op.line === jia3.data("line"), JSON.stringify(calls.at(-1)));
    v.update("根\n  乙\n");
    byLabel("乙").emit("tap");
    press(stage, { key: "Backspace" });
    await sleep(0);
    ok("编辑：Backspace 也是删除", calls.at(-1).op.kind === "remove");
    v.update("根\n  乙\n  乙2\n");
    byLabel("乙2").emit("tap");
    press(stage, { key: "Tab", shiftKey: true });
    await sleep(0);
    ok("编辑：Shift+Tab 是提一级", calls.at(-1).op.kind === "promote");
    // 插件说做不了：弹提示，等待状态解除，没有留下临时节点
    v.update("根\n  乙\n  乙3\n");
    reply = { ok: false, reason: "已经是最上面一级了" };
    byLabel("根").emit("tap");
    press(stage, { key: "Tab", shiftKey: true });
    await sleep(0);
    ok("编辑：做不了时在图里弹提示，不再等重画", toastShown() && toastText() === "已经是最上面一级了" && v.busy === false, toastText());
    reply = { ok: true };

    // —— 方向键 ——
    v.update(src);
    byLabel("根").emit("tap");
    const sel = () => v.selected?.data("label");
    const arrow = (key: string) => press(stage, { key });
    arrow("ArrowRight");
    ok("编辑：→ 选第一个子节点", sel() === "甲");
    arrow("ArrowDown");
    ok("编辑：↓ 选后一个同级", sel() === "乙一");
    arrow("ArrowUp");
    ok("编辑：↑ 选前一个同级", sel() === "甲");
    arrow("ArrowRight");
    ok("编辑：再 → 进到甲一", sel() === "甲一");
    arrow("ArrowLeft");
    ok("编辑：← 回到上一级", sel() === "甲");
    ok("编辑：方向键不选概要节点", (() => { arrow("ArrowDown"); arrow("ArrowDown"); arrow("ArrowDown"); return sel() !== undefined && !v.selected.hasClass("summary-node"); })());
    cy.emit("tap");
    arrow("ArrowDown");
    ok("编辑：没选中时按方向键选第一个节点", sel() === "根");

    // —— 没有焦点时不抢键 ——
    byLabel("甲").emit("tap");
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); // 点到图外面
    const nBefore = calls.length;
    const stray = press(document.body, { key: "Enter" });
    const strayDel = press(document.body, { key: "Delete" });
    const strayUndo = press(document.body, { key: "z", ...MOD });
    ok("编辑：图没有焦点时按键不归图管（不动手、不拦截）", !inputEl() && calls.length === nBefore && !stray.defaultPrevented && !strayDel.defaultPrevented && !strayUndo.defaultPrevented);
    ok("编辑：图没有焦点时普通滚轮不拦截", !wheelOn(stage, { deltaY: 100 }, -120).defaultPrevented);
    // 按键落在图自己以外的元素（比如链接菜单里）上也不处理
    stage.focus();
    const zStage = cy.zoom();
    wheelOn(stage, { deltaY: 100 }, -120);
    ok("编辑：图有焦点时鼠标滚轮缩放", cy.zoom() !== zStage);
    // Esc：有选中先取消选中，再按放开焦点
    press(stage, { key: "Escape" });
    ok("编辑：Esc 先取消选中", v.selected === null && document.activeElement === stage);
    press(stage, { key: "Escape" });
    ok("编辑：再按 Esc 放开焦点", document.activeElement !== stage);

    // —— 撤回 / 重做：拖动 ——
    {
      plugin.editNode = realEdit;
      const hist = plugin.history(plugin.viewportKey("t.md", "e1"));
      hist.undo.length = 0;
      hist.redo.length = 0;
      const stageEl = stage;
      stageEl.style.height = "420px";
      cy.resize();
      v.fit();
      const target = byLabel("甲");
      const start = { ...target.position() };
      const box = stageEl.getBoundingClientRect();
      const rp = target.renderedPosition();
      const mouse = (type: string, t: EventTarget, x: number, y: number) =>
        t.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, button: 0, buttons: type === "mouseup" ? 0 : 1, bubbles: true, cancelable: true }));
      mouse("mousedown", stageEl.querySelector("canvas")!, box.left + rp.x, box.top + rp.y);
      mouse("mousemove", window, box.left + rp.x + 40, box.top + rp.y + 40);
      mouse("mousemove", window, box.left + rp.x + 90, box.top + rp.y + 90);
      mouse("mouseup", window, box.left + rp.x + 90, box.top + rp.y + 90);
      const dragged = { ...target.position() };
      ok("撤回：拖动后位置变了、被选中、记了一步", Math.abs(dragged.x - start.x) + Math.abs(dragged.y - start.y) > 20 && v.selected === target && hist.undo.length === 1 && hist.undo[0].kind === "pos");
      ok("撤回：位置记在数据里", !!note2.diagrams["e1" as keyof typeof note2.diagrams]);
      stageEl.focus();
      const z = press(stageEl, { key: "z", ...MOD });
      const back = target.position();
      ok("撤回：⌘Z 把节点放回拖动之前的位置", z.defaultPrevented && Math.abs(back.x - start.x) < 1 && Math.abs(back.y - start.y) < 1, `${JSON.stringify(start)} vs ${JSON.stringify(back)}`);
      ok("撤回：弹「已撤回」，这一步挪进重做栈", toastShown() && toastText() === "已撤回" && hist.undo.length === 0 && hist.redo.length === 1);
      press(stageEl, { key: "z", shiftKey: true, ...MOD });
      ok("撤回：⌘⇧Z 重做，位置又回到拖到的地方", Math.abs(target.position().x - dragged.x) < 1 && toastText() === "已重做" && hist.redo.length === 0);
      press(stageEl, { key: "z", ...MOD });
      press(stageEl, { key: "y", ctrlKey: true });
      ok("撤回：Ctrl+Y 也是重做", Math.abs(target.position().x - dragged.x) < 1);
      press(stageEl, { key: "z", ...MOD });
      press(stageEl, { key: "z", ...MOD });
      ok("撤回：撤到头了提示没有可撤回的", toastText() === "没有可以撤回的了");
      press(stageEl, { key: "z", ...MOD });
      press(stageEl, { key: "z", shiftKey: true, ...MOD });
      press(stageEl, { key: "z", shiftKey: true, ...MOD });
      ok("撤回：重做到头了提示没有可重做的", toastText() === "没有可以重做的了");
      // 「重新自动排版」也能撤回
      const resetBtn = Array.from(el.querySelectorAll("button")).find((b) => b.textContent === "重新自动排版") as HTMLButtonElement;
      resetBtn.disabled = false;
      resetBtn.click();
      ok("撤回：重新自动排版记了一步", hist.undo.length >= 1 && hist.undo.at(-1).kind === "pos" && Object.keys(v.data.pos).length === 0);
      press(stageEl, { key: "z", ...MOD });
      ok("撤回：⌘Z 把排版前的位置换回来", Object.keys(v.data.pos).length > 0);
      // 撤回栈上限
      for (let i = 0; i < 130; i++) plugin.pushHistory(plugin.viewportKey("t.md", "e1"), { kind: "pos", before: {}, after: {} });
      ok("撤回：一张图最多记 100 步，新操作清空重做栈", hist.undo.length === 100 && hist.redo.length === 0);
    }
    delete plugin.nodeText; // 还原成插件自己的
    delete plugin.editNode;
    delete plugin.previewEdit;
    E.unload();
  }

  // 8g. 插件对象 + 假的库：真的改笔记、撤回、改完选中（和侧栏的流程一致）
  {
    vaultText = "# 订单\n- 下单\n  - 校验\n- 发货\n\n正文一段。\n";
    const NOTE_ID = "__outline__";
    const note3 = { version: 1 as const, diagrams: {} };
    const el = document.createElement("div");
    host.appendChild(el);
    const view = new FlowView(el, plugin, extractOutlineFromMarkdown(vaultText), "n.md", NOTE_ID, note3 as any);
    view.load();
    const v: any = view;
    const cy = cyOf(v);
    const stage = el.querySelector(".outline-flow-stage") as HTMLElement;
    const byLabel = (t: string) => cy.nodes().filter((n: any) => n.data("label") === t).first();
    /** 侧栏的做法：笔记变了就拿新的大纲就地更新 */
    const redraw = () => v.update(extractOutlineFromMarkdown(vaultText));
    const input = () => el.querySelector("input.outline-flow-input") as HTMLInputElement | null;
    const toastText = () => (el.querySelector(".outline-flow-toast") as HTMLElement).textContent ?? "";
    const hist = plugin.history(plugin.viewportKey("n.md", NOTE_ID));
    hist.undo.length = 0;
    hist.redo.length = 0;
    const original = vaultText;

    byLabel("下单").emit("tap");
    press(stage, { key: "Tab" });
    await sleep(5);
    ok("写笔记：Tab 后新节点已按最终位置排进图里（还没写笔记）", vaultText === original && v.mainNodes().filter((n: any) => n.hasClass("fresh")).length === 1);
    input()!.value = "新步骤";
    press(input()!, { key: "Enter" });
    await sleep(0);
    ok("写笔记：加下级：笔记里多了一行，缩进和格式对", vaultText === "# 订单\n- 下单\n  - 校验\n  - 新步骤\n- 发货\n\n正文一段。\n", JSON.stringify(vaultText));
    ok("写笔记：记了一步文字撤回", hist.undo.length === 1 && hist.undo[0].kind === "text");
    redraw();
    ok("写笔记：重画后自动选中新节点", v.selected?.data("label") === "新步骤", v.selected?.data("label"));
    ok("写笔记：重画后焦点回到图上", document.activeElement === stage);
    press(stage, { key: "Enter" });
    await sleep(5);
    ok("写笔记：重画后能直接接着按回车加同级", !!input());
    press(input()!, { key: "Escape" });

    press(stage, { key: "z", ...MOD });
    await sleep(0);
    ok("撤回：⌘Z 把笔记写回改之前的样子", vaultText === original, JSON.stringify(vaultText));
    redraw();
    ok("撤回：重画后选中的是改之前选中的那个节点，并弹「已撤回」", v.selected?.data("label") === "下单" && toastText() === "已撤回", `${v.selected?.data("label")} ${toastText()}`);
    press(stage, { key: "z", shiftKey: true, ...MOD });
    await sleep(0);
    ok("撤回：⌘⇧Z 重做", vaultText.includes("  - 新步骤"));
    redraw();
    ok("撤回：重做后选中新节点、弹「已重做」", v.selected?.data("label") === "新步骤" && toastText() === "已重做");

    // 笔记在别处被改过：撤不了，丢掉这一步
    vaultText += "别处加的一行\n";
    press(stage, { key: "z", ...MOD });
    await sleep(0);
    ok("撤回：笔记在别处改过了，不动手", vaultText.endsWith("别处加的一行\n") && vaultText.includes("  - 新步骤"));
    ok("撤回：这一步被丢掉，没有进重做栈", hist.undo.length === 0 && hist.redo.length === 0, `${hist.undo.length}/${hist.redo.length}`);
    v.busy = false;

    // 图和笔记对不上（用户正好在编辑器里打了字，图还没来得及跟上）：不动手，图里提示
    redraw();
    byLabel("发货").emit("tap");
    vaultText = vaultText.replace("- 下单", "- 下单啦");
    press(stage, { key: "Delete" });
    await sleep(0);
    ok("写笔记：图没跟上笔记时拒绝，提示稍等", toastText().includes("笔记刚刚变了") && vaultText.includes("- 发货"), toastText());
    redraw();

    // 删除：选中后一个同级，没有就前一个
    byLabel("发货").emit("tap");
    press(stage, { key: "Delete" });
    await sleep(0);
    ok("写笔记：删除：笔记里整项没了，其余原样（含正文）", !vaultText.includes("发货") && vaultText.includes("正文一段。"), JSON.stringify(vaultText));
    redraw();
    ok("写笔记：删除后选中前一个同级", v.selected?.data("label") === "下单啦", v.selected?.data("label"));

    // 改字
    byLabel("校验").emit("tap");
    press(stage, { key: "F2" });
    await sleep(0);
    ok("写笔记：改字：输入框里是笔记里的原文", input()?.value === "校验", input()?.value);
    input()!.value = "校验库存";
    press(input()!, { key: "Enter" });
    await sleep(0);
    ok("写笔记：改字：只换这一行的字", vaultText.includes("  - 校验库存\n") && !vaultText.includes("  - 校验\n"), JSON.stringify(vaultText));
    redraw();
    ok("写笔记：改字后选中它", v.selected?.data("label") === "校验库存");

    // ⌥↑ / ⌥↓：和相邻的同级换位置；已经在头上或末尾时提示
    byLabel("下单啦").emit("tap");
    press(stage, { key: "ArrowDown", altKey: true });
    await sleep(0);
    ok("写笔记：⌥↓ 已经是最后一个时提示", toastText() === "已经是这一层的最后一个了", toastText());
    const kids = vaultText.split("\n").filter((l) => l.startsWith("  - ")).map((l) => l.slice(4));
    if (kids.length >= 2) {
      byLabel(kids[1]).emit("tap");
      press(stage, { key: "ArrowUp", altKey: true });
      await sleep(0);
      const after = vaultText.split("\n").filter((l) => l.startsWith("  - ")).map((l) => l.slice(4));
      ok("写笔记：⌥↑ 和上一个同级换位置", after[0] === kids[1] && after[1] === kids[0], JSON.stringify([kids, after]));
      redraw();
    } else ok("写笔记：⌥↑ 测试前提（至少两个同级）", false, JSON.stringify(vaultText));

    // 右键菜单：节点上有加下级、删除等；空白处有适应窗口
    const nodeMenu = () => (globalThis as any).__outlineFlowMenu?.items.map((i: any) => i.title) ?? [];
    (globalThis as any).__outlineFlowMenu = null;
    const tgt = byLabel("校验库存");
    tgt.emit("cxttap", [], { originalEvent: new MouseEvent("contextmenu") });
    (v as any).showMenu(tgt, new MouseEvent("contextmenu"));
    ok("右键：节点菜单里有加下级、上移、在笔记里定位、删除", ["加下级", "加同级", "改字", "上移", "下移", "提一级", "在笔记里定位", "删除（连同下级）"].every((x) => nodeMenu().includes(x)), nodeMenu().join(","));
    ok("右键：右键的节点被选中", v.selected?.data("label") === "校验库存");
    (v as any).showMenu(null, new MouseEvent("contextmenu"));
    ok("右键：空白处菜单里有适应窗口、导出网页", nodeMenu().includes("适应窗口") && nodeMenu().includes("导出网页"), nodeMenu().join(","));

    // 点节点跟着滚：找到开着这篇笔记的编辑器，选中节点对应的那一行（不抢焦点）
    {
      const calls2: any[] = [];
      const mv: any = Object.create(MarkdownView.prototype);
      mv.file = { path: "n.md" };
      mv.getMode = () => "source";
      mv.editor = {
        getValue: () => vaultText,
        getLine: (l: number) => vaultText.split("\n")[l],
        setSelection: (a: any, b: any) => calls2.push(["sel", a.line, b.ch]),
        scrollIntoView: () => calls2.push(["scroll"]),
      };
      const realLeaves = fakeApp.workspace.getLeavesOfType;
      fakeApp.workspace.getLeavesOfType = () => [{ view: mv }];
      const target = byLabel("校验库存");
      await plugin.revealSourceLine("n.md", NOTE_ID, target.data("line"), false);
      const want = vaultText.split("\n").findIndex((l) => l.includes("校验库存"));
      ok("跟着滚：选中笔记里对应的那一行并滚过去", calls2[0]?.[0] === "sel" && calls2[0][1] === want && calls2.some((c) => c[0] === "scroll"), JSON.stringify(calls2) + " want " + want);
      fakeApp.workspace.getLeavesOfType = realLeaves;
    }

    // 标题：Delete 整节，不在这个测试里弹 Notice（Obsidian 的 Notice 在网页里是空桩），只看文字
    byLabel("订单").emit("tap");
    press(stage, { key: "Delete" });
    await sleep(0);
    ok("写笔记：标题 Delete 删整节，正文段落留着（它不属于大纲，但在这一节里，整节一起删）", !vaultText.includes("订单"), JSON.stringify(vaultText));
    view.unload();
  }

  // 8z. 界面语言：切到英文再建图，工具条、选择器、提示、只读标题条都是英文；切回中文后又是中文
  {
    const own = (src: string, readonly = false) => {
      const el = document.createElement("div");
      host.appendChild(el);
      const v: any = new FlowView(el, plugin, src, readonly ? null : "lang.md", "0", { version: 1, diagrams: {} } as any, readonly ? { readonly: true, title: "t" } : {});
      v.load();
      return { v, el };
    };
    const btnTexts = (el: HTMLElement, sel = ".outline-flow-bar button") => Array.from(el.querySelectorAll(sel)).map((b) => b.textContent ?? "");
    const pickers = (el: HTMLElement) => Array.from(el.querySelectorAll(".outline-flow-picker")).map((b) => `${b.getAttribute("aria-label")}=${(b.textContent ?? "").replace("▾", "")}`);
    const src = "根\n  甲【备注】\n    甲1\n  乙\n    乙1: (甲1)\n";
    ok("语言：默认是中文", getLang() === "zh");
    setLang("en");
    try {
      const E = own(src);
      const texts = btnTexts(E.el);
      for (const want of ["Hide notes", "Group related", "Snap", "Re-layout", "Copy as Flowchart Fun", "Export web page"]) {
        ok(`语言 en：工具条有「${want}」`, texts.includes(want), texts.join(" | "));
      }
      ok("语言 en：工具条上没有中文", !texts.some((t) => /[\u3400-\u9fff]/.test(t)), texts.join(" | "));
      const pk = pickers(E.el);
      ok("语言 en：结构选择器显示 Logic chart（测试设置里是逻辑图）", pk.includes("Structure=Logic chart"), pk.join(" | "));
      ok("语言 en：主题选择器显示 Light Card", pk.includes("Theme=Light Card"), pk.join(" | "));
      const status = E.el.querySelector(".outline-flow-status")?.textContent ?? "";
      ok("语言 en：状态行是英文", /nodes, positions are automatic\./.test(status) && !/[\u3400-\u9fff]/.test(status), status);
      cyOf(E.v).nodes().not(".note").first().emit("tap");
      const keys = E.el.querySelector(".outline-flow-keys")?.textContent ?? "";
      ok("语言 en：选中节点后的按键提示是英文", /^Enter: add sibling · Tab: add child · ⇧Tab: promote · ⌥↑↓: move up\/down · Space: edit text · Delete: remove · (⌘Z|Ctrl\+Z): undo · Right-click: more/.test(keys), keys);
      E.v.update("");
      ok("语言 en：空内容提示是英文", overlayText(E.el) === "Write a line in the code block and a node will appear here.", overlayText(E.el));
      E.v.unload();
      const R = own(src, true);
      const heads = btnTexts(R.el, ".outline-flow-head button");
      ok("语言 en：只读标题条按钮是 Fit / Full screen", heads.join() === "Fit,Full screen", heads.join());
      const rhint = R.el.querySelector(".outline-flow-hint")?.textContent ?? "";
      ok("语言 en：只读右下角的操作提示是英文", /^Drag to pan · Hold (⌘|Ctrl) and scroll to zoom$/.test(rhint), rhint);
      R.v.unload();
    } finally {
      setLang("zh");
    }
    const Z = own(src);
    const zt = btnTexts(Z.el);
    ok("语言：切回中文后工具条又是中文", zt.includes("重新自动排版") && zt.includes("吸附") && !zt.includes("Snap"), zt.join(" | "));
    ok("语言：切回中文后选择器是中文", pickers(Z.el).includes("结构=逻辑图"), pickers(Z.el).join(" | "));
    Z.v.unload();
  }

  // 9. 卸载：用独立实例测，别把主图销毁了（截图还要看它）
  const tmp = make("P\n  Q\n");
  tmp.v.unload();
  ok("卸载：画布销毁", (tmp as any).v.cy === null);
} catch (e: any) {
  results.push("FAIL 抛异常中断: " + (e?.stack ?? e));
}
};

void run().then(() => {
  document.getElementById("out")!.textContent = results.join("\n") + "\n\n" + (results.some((r) => r.startsWith("FAIL")) ? "有失败" : "全部通过");
});
