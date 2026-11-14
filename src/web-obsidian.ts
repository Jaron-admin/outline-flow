// 导出的网页里用的 obsidian 替身：网页里没有 Obsidian，但 FlowView 和 main.ts 是同一份代码，
// 所以这里把它们会碰到的那些类和 DOM 辅助方法补成最小的真实现。
// 网页版（esbuild.config.mjs）和浏览器冒烟测试（visual/build-flowview.mjs）都把 "obsidian" 指到这个文件。
// 不要在这里写 declare global：类型以 obsidian 自己的声明为准，这里只在运行时补方法。

export class Component {
  private children: Component[] = [];
  private cleanups: (() => void)[] = [];
  load() {
    this.onload();
    for (const c of this.children) c.load();
  }
  unload() {
    for (const c of this.children) c.unload();
    this.onunload();
    for (const f of this.cleanups.splice(0)) f();
  }
  onload() {}
  onunload() {}
  addChild<T extends Component>(c: T): T {
    this.children.push(c);
    return c;
  }
  register(cb: () => void) {
    this.cleanups.push(cb);
  }
  registerEvent() {}
  registerInterval(id: number): number {
    this.cleanups.push(() => window.clearInterval(id));
    return id;
  }
  registerDomEvent(el: EventTarget, type: string, cb: (e: any) => void, options?: boolean | AddEventListenerOptions) {
    el.addEventListener(type, cb, options);
    this.cleanups.push(() => el.removeEventListener(type, cb, options));
  }
}

export class MarkdownRenderChild extends Component {
  containerEl: HTMLElement;
  constructor(el: HTMLElement) {
    super();
    this.containerEl = el;
  }
}

export class ItemView extends Component {
  containerEl: HTMLElement = document.createElement("div");
  contentEl: HTMLElement = document.createElement("div");
  constructor(public leaf: any) {
    super();
  }
}

export class Plugin extends Component {
  constructor(public app: any, public manifest: any) {
    super();
  }
  loadData() {
    return Promise.resolve(null);
  }
  saveData() {
    return Promise.resolve();
  }
}

export class PluginSettingTab {
  containerEl = document.createElement("div");
  constructor(public app: any, public plugin: any) {}
}

export class Setting {
  constructor(_el: HTMLElement) {}
  setName() {
    return this;
  }
  setDesc() {
    return this;
  }
  addText() {
    return this;
  }
  addDropdown() {
    return this;
  }
  addToggle() {
    return this;
  }
}

export class MarkdownView extends Component {}
export class WorkspaceLeaf {}
export class App {}
export class TAbstractFile {}
export class TFile {
  extension = "md";
  path = "";
}
export class Notice {
  constructor(_msg: string) {}
}
export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
}

// ---- Obsidian 给 HTMLElement 加的那套扩展方法 ----
interface DomOpts {
  cls?: string | string[];
  text?: string;
  attr?: Record<string, string | number | boolean | null>;
  title?: string;
  type?: string;
  value?: string;
  href?: string;
  placeholder?: string;
  parent?: HTMLElement;
  prepend?: boolean;
}

const apply = (el: HTMLElement, o?: DomOpts | string) => {
  if (o === undefined) return;
  if (typeof o === "string") {
    el.className = o;
    return;
  }
  if (o.cls) el.className = Array.isArray(o.cls) ? o.cls.join(" ") : o.cls;
  if (o.text !== undefined) el.textContent = o.text;
  if (o.attr) for (const [k, v] of Object.entries(o.attr)) if (v !== null && v !== false) el.setAttribute(k, String(v));
  if (o.title !== undefined) el.title = o.title;
  if (o.type) el.setAttribute("type", o.type);
  if (o.value !== undefined) el.setAttribute("value", o.value);
  if (o.href !== undefined) el.setAttribute("href", o.href);
  if (o.placeholder !== undefined) el.setAttribute("placeholder", o.placeholder);
};

const place = (parent: HTMLElement, el: HTMLElement, o?: DomOpts | string) => {
  if (typeof o === "object" && o.prepend) parent.insertBefore(el, parent.firstChild);
  else parent.appendChild(el);
};

// 用 any 打补丁：不在类型层面声明，免得和 obsidian.d.ts 里的同名方法打架
const proto = HTMLElement.prototype as any;
proto.empty = function (this: HTMLElement) {
  while (this.firstChild) this.removeChild(this.firstChild);
};
proto.createEl = function (this: HTMLElement, tag: string, o?: DomOpts | string) {
  const el = document.createElement(tag);
  apply(el, o);
  if (tag === "option") {
    const opt = typeof o === "object" ? o : undefined;
    el.textContent = opt?.text ?? "";
    (el as HTMLOptionElement).value = opt?.value ?? opt?.text ?? "";
  }
  place(this, el, o);
  return el;
};
proto.createDiv = function (this: HTMLElement, o?: DomOpts | string) {
  return proto.createEl.call(this, "div", o);
};
proto.createSpan = function (this: HTMLElement, o?: DomOpts | string) {
  return proto.createEl.call(this, "span", o);
};
proto.addClass = function (this: HTMLElement, ...c: string[]) {
  this.classList.add(...c);
};
proto.removeClass = function (this: HTMLElement, ...c: string[]) {
  this.classList.remove(...c);
};
proto.toggleClass = function (this: HTMLElement, c: string | string[], value: boolean) {
  for (const one of Array.isArray(c) ? c : [c]) this.classList.toggle(one, value);
};
proto.setText = function (this: HTMLElement, t: string) {
  this.textContent = t;
};
proto.setAttr = function (this: HTMLElement, k: string, v: string) {
  this.setAttribute(k, v);
};
proto.show = function (this: HTMLElement) {
  this.style.removeProperty("display");
};
proto.hide = function (this: HTMLElement) {
  this.style.setProperty("display", "none");
};
proto.setCssStyles = function (this: HTMLElement, styles: Record<string, string | number | null | undefined>) {
  for (const [k, v] of Object.entries(styles)) {
    if (v === null || v === undefined) continue;
    // 键是驼峰写法（fontSize），要转成 CSS 的连字符写法（font-size）
    this.style.setProperty(k.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase()), String(v));
  }
};
proto.setCssProps = function (this: HTMLElement, props: Record<string, string | number | null | undefined>) {
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined) continue;
    this.style.setProperty(k, String(v));
  }
};

/** 网页里：当成电脑上用；是不是 Mac / iOS 由页面里那段内联脚本先算好 */
export const Platform = {
  isMobile: false,
  isMobileApp: false,
  isPhone: false,
  isDesktop: true,
  isDesktopApp: false,
  isMacOS: (globalThis as any).__outlineFlowIsMac === true,
  isIosApp: (globalThis as any).__outlineFlowIsMac === true,
};
