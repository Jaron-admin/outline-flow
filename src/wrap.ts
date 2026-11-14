// 节点文字自己断行，不交给绘图库：绘图库只会按宽度硬切，中文的逗号、句号会跑到下一行开头，
// 最后一行也常常只剩一两个字。这里按中文排版的习惯断：
// - 句读和收尾的标点（，。、；：！？）》」』】… 等）不放行首：放不下时把前一个字一起带到下一行；
// - 开头的标点（（《「『【“ 等）不留在行尾；
// - 英文单词、数字、网址连在一起不拆，除非一个词本身就比一行还宽；
// - 行数定了以后再把每行收窄到刚好不多出一行，各行长短均匀，不会剩一个字孤零零挂在最后。
// 纯函数，量字宽的方法从外面传进来，测试里用估算，插件里用画布真量。

export type Measure = (text: string) => number;

/** 不能放在行首的字 */
const NO_START = new Set([..."，。、；：！？）》」』】〕〉〗”’…·%,.;:!?)]}>～—‰"]);
/** 不能放在行尾的字 */
const NO_END = new Set([..."（《「『【〔〈〖“‘([{<"]);

/** 拆成不能再拆的小块：一个中文字（连同紧跟的标点各自成块）、一个英文词或数字串、一个空格 */
export function units(text: string): string[] {
  const out: string[] = [];
  const re = /[A-Za-z0-9_@#$&+=\-./:?%~'*^]+|\s+|[\s\S]/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(m[0]);
  return out;
}

/** 按最大宽度贪心地排，遵守行首行尾的禁则；返回各行 */
function greedy(us: string[], max: number, measure: Measure): string[] {
  const lines: string[][] = [[]];
  let w = 0;
  const cur = () => lines[lines.length - 1];
  const push = (u: string) => {
    cur().push(u);
    w += measure(u);
  };
  const newLine = (carry: string[]) => {
    lines.push([]);
    w = 0;
    for (const c of carry) push(c);
  };
  for (const u of us) {
    const uw = measure(u);
    // 一个词本身就比一行宽：只好在词里按字切
    if (uw > max && u.length > 1) {
      for (const ch of u) {
        if (cur().length && w + measure(ch) > max) newLine([]);
        push(ch);
      }
      continue;
    }
    if (cur().length === 0 || w + uw <= max) {
      if (/^\s+$/.test(u) && cur().length === 0) continue; // 行首的空格不要
      push(u);
      continue;
    }
    if (/^\s+$/.test(u)) {
      newLine([]);
      continue;
    }
    // 放不下。先决定从哪里断：
    const line = cur();
    let carry: string[] = [];
    if (NO_START.has(u[0])) {
      // 这个标点不能当行首：把前一块一起带下去（前一块要是也是标点，就再往前一块）
      while (line.length > 1 && carry.length < 3) {
        const prev = line.pop()!;
        w -= measure(prev);
        carry.unshift(prev);
        if (!NO_START.has(prev[0])) break;
      }
    }
    // 行尾是开头的标点：也带下去
    while (line.length > 1 && NO_END.has(line[line.length - 1].slice(-1))) {
      const prev = line.pop()!;
      w -= measure(prev);
      carry.unshift(prev);
    }
    // 去掉行尾空格
    while (line.length && /^\s+$/.test(line[line.length - 1])) line.pop();
    newLine(carry);
    push(u);
  }
  return lines.map((l) => l.join("").trimEnd()).filter((l, i, all) => l !== "" || all.length === 1);
}

/**
 * 断行。max 是一行最宽多少像素。原文里自带的换行保留。
 * 返回用 \n 连起来的字，绘图库照着画就行。
 */
export function wrapText(text: string, max: number, measure: Measure): string {
  return text
    .split("\n")
    .map((para) => {
      const us = units(para);
      const first = greedy(us, max, measure);
      if (first.length < 2) return first.join("\n");
      // 行数定了，找最窄的宽度，行数不变：各行长短均匀
      let lo = max / 2;
      let hi = max;
      let best = first;
      for (let i = 0; i < 12; i++) {
        const mid = (lo + hi) / 2;
        const t = greedy(us, mid, measure);
        if (t.length <= first.length) {
          hi = mid;
          best = t;
        } else lo = mid;
      }
      return best.join("\n");
    })
    .join("\n");
}

/** 没有画布时的估算：中文一个字一个字号宽，其余半个多一点 */
export function estimate(fontPx: number): Measure {
  return (s) => {
    let w = 0;
    for (const ch of s) w += ch.charCodeAt(0) > 0x2e80 ? fontPx : fontPx * 0.56;
    return w;
  };
}

let ctx: CanvasRenderingContext2D | null | undefined;
/** 用画布按真实字体量；拿不到画布（测试环境）就估算 */
export function canvasMeasure(font: string, fontPx: number): Measure {
  if (ctx === undefined) {
    try {
      ctx = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
    } catch {
      ctx = null;
    }
  }
  if (!ctx) return estimate(fontPx);
  const c = ctx;
  return (s) => {
    c.font = font;
    return c.measureText(s).width;
  };
}

const cache = new Map<string, string>();
/** 带缓存的断行：同一段字、同一个字体和宽度只算一次 */
export function wrapCached(text: string, max: number, font: string, fontPx: number): string {
  if (!text) return "";
  const key = `${font}\u0000${max}\u0000${text}`;
  let v = cache.get(key);
  if (v === undefined) {
    v = wrapText(text, max, canvasMeasure(font, fontPx));
    if (cache.size > 5000) cache.clear();
    cache.set(key, v);
  }
  return v;
}
