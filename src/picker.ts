// 工具条上的选择菜单（结构、主题）。不用系统自带的下拉：Mac 上它会把列表盖在按钮上、只露出一截，
// 下面空间再大也要滚着找；也没法分组、没法给主题配色块。这里点按钮在下面弹出整张列表，分组显示，
// 放不下才在列表里滚。

export interface PickItem {
  value: string;
  label: string;
  /** 主题的几个代表色，画成一排小圆点 */
  swatch?: string[];
}

export interface PickGroup {
  title?: string;
  items: PickItem[];
}

export class Picker {
  readonly button: HTMLButtonElement;
  private pop: HTMLElement | null = null;
  private value: string;
  private readonly off: (() => void)[] = [];

  constructor(
    bar: HTMLElement,
    /** 弹出的列表放在哪（图的外框），用来算位置和限制高度 */
    private host: HTMLElement,
    private opts: { aria: string; groups: PickGroup[]; value: string; onChange: (v: string) => void },
  ) {
    this.value = opts.value;
    this.button = bar.createEl("button", { cls: "outline-flow-picker", attr: { "aria-label": opts.aria, "aria-haspopup": "listbox" } });
    this.render();
    this.button.addEventListener("click", (e) => {
      e.stopPropagation();
      if (this.pop) this.close();
      else this.open();
    });
  }

  private find(v: string): PickItem | undefined {
    for (const g of this.opts.groups) for (const it of g.items) if (it.value === v) return it;
    return undefined;
  }

  private render() {
    const it = this.find(this.value);
    this.button.empty();
    if (it?.swatch) this.dots(this.button, it.swatch);
    this.button.createEl("span", { text: it?.label ?? this.value });
    this.button.createEl("span", { cls: "outline-flow-picker-caret", text: "▾" });
  }

  private dots(parent: HTMLElement, colors: string[]) {
    const box = parent.createEl("span", { cls: "outline-flow-swatch" });
    for (const c of colors.slice(0, 5)) {
      const d = box.createEl("span");
      d.style.background = c;
    }
  }

  get current(): string {
    return this.value;
  }

  setValue(v: string) {
    this.value = v;
    this.render();
  }

  /** 选一项（测试和程序里用，和点一下效果一样） */
  pick(v: string) {
    this.close();
    if (v === this.value) return;
    this.setValue(v);
    this.opts.onChange(v);
  }

  open() {
    if (this.pop) return;
    const pop = (this.pop = this.host.createDiv({ cls: "outline-flow-picker-pop", attr: { role: "listbox" } }));
    for (const g of this.opts.groups) {
      if (g.title) pop.createDiv({ cls: "outline-flow-picker-group", text: g.title });
      for (const it of g.items) {
        const row = pop.createDiv({ cls: "outline-flow-picker-item", attr: { role: "option" } });
        if (it.value === this.value) row.addClass("is-current");
        if (it.swatch) this.dots(row, it.swatch);
        row.createEl("span", { text: it.label });
        row.addEventListener("click", (e) => {
          e.stopPropagation();
          this.pick(it.value);
        });
      }
    }
    // 位置：按钮正下方；最多用到图的底边，再长就在列表里滚
    const hb = this.host.getBoundingClientRect();
    const bb = this.button.getBoundingClientRect();
    pop.style.left = bb.left - hb.left + "px";
    pop.style.top = bb.bottom - hb.top + 4 + "px";
    const room = hb.bottom - bb.bottom - 12;
    if (room > 120) pop.style.maxHeight = room + "px";
    pop.querySelector(".is-current")?.scrollIntoView?.({ block: "nearest" });
    // 点别处、按 Esc 收起
    const away = (e: Event) => {
      if (!pop.contains(e.target as Node) && e.target !== this.button) this.close();
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        this.close();
      }
    };
    const doc = this.host.ownerDocument;
    doc.addEventListener("mousedown", away, true);
    doc.addEventListener("keydown", esc, true);
    this.off.push(() => doc.removeEventListener("mousedown", away, true), () => doc.removeEventListener("keydown", esc, true));
    this.button.addClass("is-open");
  }

  close() {
    this.pop?.remove();
    this.pop = null;
    this.button.removeClass("is-open");
    while (this.off.length) this.off.pop()!();
  }
}
