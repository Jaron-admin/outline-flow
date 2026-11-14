// 量一下「销毁重建」和「就地更新」的差距，别空口说优化了。
import { FlowView } from "../src/main";
import { buildElements } from "../src/graph";

const settings = { folder: "流程图位置", theme: "card", direction: "LR", line: "poly", snap: true, height: 420 };
const plugin: any = {
  settings,
  track() {},
  untrack() {},
  broadcast() {},
  saveNote: () => Promise.resolve(),
  loadNote: () => Promise.resolve({ version: 1, diagrams: {} }),
  viewportKey: () => "k",
  rememberViewport() {},
  recallViewport: () => null,
};

const host = document.getElementById("host")!;
const note = { version: 1 as const, diagrams: {} };

/** 造一份 n 个节点的大纲 */
function src(n: number) {
  const lines = ["根"];
  for (let i = 0; i < n; i++) lines.push(`  节点${i}`);
  return lines.join("\n");
}

function create(source: string) {
  const el = document.createElement("div");
  host.appendChild(el);
  const v = new FlowView(el, plugin, source, "t.md", "0", note as any, {});
  v.load();
  return v;
}

const N = 30; // 每次改一个字的模拟次数
const SIZES = [15, 40];

const out: string[] = [];
for (const size of SIZES) {
  const base = src(size);
  // 每次内容都有微小变化（模拟打字）
  const versions = Array.from({ length: N }, (_, i) => base.replace("节点0", `节点0改动${i}`));

  // A. 旧做法：每次换掉整个 FlowView（销毁 cytoscape 再新建）
  // 注意要显式 fit：真实环境里是 ResizeObserver 异步触发的，同步循环里不会跑，
  // 不补这一步就变成拿「没 fit 的重建」比「有 fit 的更新」，测了个假的。
  const t0 = performance.now();
  for (const v of versions) {
    const f = create(v);
    (f as any).fit();
    f.unload();
  }
  const rebuild = performance.now() - t0;

  // B. 新做法：一个实例，就地 update
  const t1 = performance.now();
  const keep = create(base);
  for (const v of versions) keep.update(v);
  const inplace = performance.now() - t1;

  out.push(
    `${size} 个节点，改 ${N} 次：\n` +
      `  销毁重建 ${rebuild.toFixed(0)} ms（每次 ${(rebuild / N).toFixed(2)} ms）\n` +
      `  就地更新 ${inplace.toFixed(0)} ms（每次 ${(inplace / N).toFixed(2)} ms）\n` +
      `  快 ${(rebuild / inplace).toFixed(1)} 倍`,
  );
}

// 纯解析占多少：如果解析本身就很贵，上面两条怎么优化都是小数
{
  const v = src(40);
  const t = performance.now();
  for (let i = 0; i < N; i++) buildElements(v);
  const parse = performance.now() - t;
  out.push(`只看解析（40 节点 × ${N} 次）：${parse.toFixed(0)} ms（每次 ${(parse / N).toFixed(2)} ms）`);
}

document.getElementById("out")!.textContent = out.join("\n\n");
