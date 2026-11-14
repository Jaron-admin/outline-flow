// 只为「肉眼确认图长什么样」用的临时页面，不参与插件构建。
// 把 src/ 里的解析、排版、样式原样搬到浏览器里跑一遍，再用 Chrome 截图。
// 参数：src / dir / line / theme / structure，见 visual/index.html。
import cytoscape from "cytoscape";
import { buildElements } from "../src/graph";
import { layoutPoints } from "../src/pack";
import { applyCurves } from "../src/curve";
import { routeFish } from "../src/fish";
import { routeRadial } from "../src/radial";
import { GRID, THEMES, axisFor, styleFor } from "../src/themes";
import { addBraces, bracesFrom, placeBraces } from "../src/brace";
import type { Direction, LineMode, Structure } from "../src/themes";

const q = new URLSearchParams(location.search);
const dir0 = (q.get("dir") ?? "LR") as Direction;
const line = (q.get("line") ?? "poly") as LineMode;
const theme = q.get("theme") ?? "card";
const structure = (q.get("structure") ?? "logic") as Structure;
const src = decodeURIComponent(q.get("src") ?? "");
const dir = axisFor(structure, dir0); // 非逻辑图的方向是定死的，和插件里一样

const stage = document.getElementById("stage")!;
stage.style.background = (THEMES[theme] ?? THEMES.card).stage; // 画布底色跟主题走，和插件里一样
document.body.style.background = (THEMES[theme] ?? THEMES.card).canvas;

const els = buildElements(src, structure);
const braces = bracesFrom(els);
const core = els.filter((e) => e.group === "nodes" || e.group === "edges");

const cy = cytoscape({
  container: stage,
  elements: core as any,
  style: styleFor(theme, dir, "sans-serif", line, structure),
  userZoomingEnabled: false,
});

addBraces(cy, braces);

const main = cy.nodes().not(".note").not(".summary-anchor");
const list: any[] = main.toArray();
main.forEach((n: any) => {
  const t = n.data("note");
  if (t) cy.add({ group: "nodes", data: { id: n.id() + "::note", label: t }, classes: "note" } as any);
});
const cell = (n: any, sized: boolean) => {
  const note = cy.getElementById(n.id() + "::note");
  return {
    col: n.data("col") ?? 0,
    row: n.data("row") ?? 0,
    w: sized ? Math.max(n.outerWidth(), note.nonempty() ? note.outerWidth() : 0) : 0,
    h: sized ? n.outerHeight() + (note.nonempty() ? note.outerHeight() + 4 : 0) : 0,
    polar: n.data("polar"),
    fish: n.data("fish"),
    inLabel: n.data("inLabel"),
    inKind: n.data("inKind"),
    summary: n.hasClass("summary-node"),
  };
};
// 尺寸要等样式算出来才有，所以先按兜底尺寸摆一遍位置、再拿真实尺寸摆第二遍
list.forEach((n, i) => n.position(layoutPoints(list.map((m) => cell(m, false)), structure, dir)[i]));
list.forEach((n, i) => n.position(layoutPoints(list.map((m) => cell(m, true)), structure, dir)[i]));

main.forEach((n: any) => {
  const note = cy.getElementById(n.id() + "::note");
  if (note.empty()) return;
  const p = n.position();
  note.position({ x: p.x, y: p.y + n.outerHeight() / 2 + note.outerHeight() / 2 + 2 });
});

placeBraces(cy, braces, dir);
if (structure === "fishbone") routeFish(cy);
applyCurves(cy, dir, line === "curve" && !["timeline", "fishbone", "radial"].includes(structure));
if (structure === "radial") routeRadial(cy, line); // 要在 applyCurves 后面：它关弧线时会把控制点清掉

cy.fit(undefined, 30);
if (cy.zoom() > 1.2) {
  cy.zoom(1.2);
  cy.center();
}

// 下面这段是从 src/main.ts 的 updateRefs 抄过来的，只为让截图和插件里看到的一致。
// 引用线两头在同一排/同一列时要从图外侧绕一个方框，不然会压在正中线上。
const CLEAR = 22;
cy.edges(".ref").forEach((e: any) => {
  if (line !== "poly") return;
  const a = e.source();
  const b = e.target();
  const pa = a.position();
  const pb = b.position();
  const dx = Math.abs(pb.x - pa.x);
  const dy = Math.abs(pb.y - pa.y);
  const sameRow = dy < GRID / 2;
  const sameCol = dx < GRID / 2;
  if (!(sameRow || sameCol) || a.id() === b.id()) return;
  const gap = sameRow ? dx : dy;
  const need = sameRow
    ? (a.outerWidth() + b.outerWidth()) / 2 + CLEAR * 2
    : (a.outerHeight() + b.outerHeight()) / 2 + CLEAR * 2;
  const shared = a.edgesWith(b).not(".ref").nonempty();
  if (!(gap > need || shared)) return;
  const box = main.boundingBox();
  const out = sameRow ? { x: 0, y: (box.y1 + box.y2) / 2 >= pa.y ? -1 : 1 } : { x: (box.x1 + box.x2) / 2 >= pa.x ? -1 : 1, y: 0 };
  const sign = Math.sign((pb.x - pa.x) * out.y - (pb.y - pa.y) * out.x) || 1;
  const reach = (n: any) => (sameRow ? n.outerHeight() : n.outerWidth()) / 2 + CLEAR;
  const end = sameRow ? `0 ${out.y < 0 ? "-50%" : "50%"}` : `${out.x < 0 ? "-50%" : "50%"} 0`;
  e.addClass("ref-u");
  e.style({
    "segment-distances": `${sign * reach(e.source())} ${sign * reach(e.target())}`,
    "source-endpoint": end,
    "target-endpoint": end,
  });
});
