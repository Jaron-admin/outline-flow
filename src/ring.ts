// 成环的内容摆成正多边形。
//
// 什么算环：大纲里顺着缩进一路往下写成一串（甲 → 乙 → 丙 → …），最后一个又用 (甲) 引用回开头。
// 比如五行：木 → 火 → 土 → 金 → 水 → (木)。按树摆，这一串会拉成一长条，回指的线从尾绕回头，
// 再加上隔一个相克的几条线，横七竖八。摆成正五边形以后：相生走外圈，相克是里面的五角星，一眼就看懂。
//
// 怎么摆：环的第一个节点留在原来的位置，整个环往远离父节点的方向展开；
// 环比原来那一条高（或宽）出来的部分，同一侧的其余节点整体往外让开，不会压上去。
// 环里节点下面要是还挂着别的子节点，跟着它一起挪。

export interface Ring {
  /** 环上的节点 id，按顺序 */
  ids: string[];
}

const TREE = (cy: any) => cy.edges().not(".ref").not(".summary").not(".brace");

/** 找出所有的环；互相重叠的只留最长的那个 */
export function findRings(cy: any): Ring[] {
  const parentOf = new Map<string, string>();
  TREE(cy).forEach((e: any) => {
    const t = e.target().id();
    if (!parentOf.has(t)) parentOf.set(t, e.source().id());
  });
  const found: string[][] = [];
  cy.edges(".ref").forEach((e: any) => {
    const from = e.source().id();
    const to = e.target().id();
    // 从引用的那一头顺着父节点往上找，找到被引用的节点就是一个环
    const path = [from];
    let cur = from;
    for (let i = 0; i < 16; i++) {
      const p = parentOf.get(cur);
      if (!p) return;
      path.push(p);
      if (p === to) {
        if (path.length >= 3) found.push(path.reverse());
        return;
      }
      cur = p;
    }
  });
  found.sort((a, b) => b.length - a.length);
  const used = new Set<string>();
  const rings: Ring[] = [];
  for (const ids of found) {
    if (ids.some((id) => used.has(id))) continue;
    ids.forEach((id) => used.add(id));
    rings.push({ ids });
  }
  return rings;
}

/**
 * 给环上的节点和线打标记，样式表照着画：
 * ring-node：环上的节点；ring：两头都在同一个环上的线（相生、相克都算）；ring-close：从尾回到头、把环合上的那条引用线，
 * 画得和相生的线一样（它本来就是相生的最后一步，只是在大纲里只能用引用写）。
 */
export function markRings(cy: any, rings: Ring[]): void {
  cy.elements().removeClass("ring ring-node ring-close");
  for (const r of rings) {
    const set = new Set(r.ids);
    const nodes = cy.collection(r.ids.map((id) => cy.getElementById(id)));
    nodes.addClass("ring-node");
    cy.edges().forEach((e: any) => {
      if (!set.has(e.source().id()) || !set.has(e.target().id())) return;
      e.addClass("ring");
      if (e.hasClass("ref") && e.source().id() === r.ids[r.ids.length - 1] && e.target().id() === r.ids[0]) {
        e.addClass("ring-close");
        // 合环的线也算这个分支的，颜色跟着走
        e.data({ br: e.target().data("br"), dep: e.target().data("dep") });
      }
    });
  }
}

/** 一个节点下面所有子孙（顺着树走，不进环上的别的节点） */
function descendants(cy: any, id: string, stop: Set<string>): any {
  let out = cy.collection();
  let frontier = cy.getElementById(id);
  for (let i = 0; i < 64 && frontier.nonempty(); i++) {
    const next = TREE(cy)
      .filter((e: any) => frontier.contains(e.source()))
      .targets()
      .filter((n: any) => !stop.has(n.id()) && !out.contains(n));
    out = out.union(next);
    frontier = next;
  }
  return out;
}

/**
 * 把环摆成正多边形。fixed：用户拖过的节点（这些不动）；axis：图往哪个方向长。
 * 返回有没有挪动东西。
 */
export function placeRings(cy: any, rings: Ring[], axis: "LR" | "TB", fixed: (n: any) => boolean): boolean {
  let moved = false;
  for (const r of rings) {
    const nodes = r.ids.map((id) => cy.getElementById(id));
    if (nodes.some((n) => n.empty()) || nodes.every((n) => fixed(n))) continue;
    const k = nodes.length;
    const head = nodes[0];
    const p0 = { ...head.position() };
    // 往哪边展开：远离父节点；没有父节点就顺着图生长的方向
    const parent = TREE(cy).filter((e: any) => e.target().same(head)).sources().first();
    let d = axis === "LR" ? { x: 1, y: 0 } : { x: 0, y: 1 };
    if (parent.nonempty()) {
      const pp = parent.position();
      const dx = p0.x - pp.x;
      const dy = p0.y - pp.y;
      // 只取主方向，环摆得端正
      d = Math.abs(dx) >= Math.abs(dy) ? { x: Math.sign(dx) || 1, y: 0 } : { x: 0, y: Math.sign(dy) || 1 };
    }
    // 半径：相邻两个节点之间至少空出一个节点宽再加线上的字的位置
    const maxW = Math.max(...nodes.map((n) => n.outerWidth()));
    const maxH = Math.max(...nodes.map((n) => n.outerHeight()));
    const R = Math.max(80, (Math.max(maxW, maxH) + 70) / (2 * Math.sin(Math.PI / k)));
    const c = { x: p0.x + d.x * R, y: p0.y + d.y * R };
    const start = Math.atan2(-d.y, -d.x); // 第一个节点在靠父节点的那一头
    const before = cy.collection(nodes).boundingBox();
    const stop = new Set(r.ids);
    nodes.forEach((n, i) => {
      if (i === 0 || fixed(n)) return;
      const a = start + (i * 2 * Math.PI) / k; // 屏幕坐标里角度增大是顺时针
      const to = { x: c.x + R * Math.cos(a), y: c.y + R * Math.sin(a) };
      const from = n.position();
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      n.position(to);
      descendants(cy, n.id(), stop).forEach((m: any) => {
        if (!fixed(m)) m.position({ x: m.position("x") + dx, y: m.position("y") + dy });
      });
    });
    moved = true;
    // 环比原来那一条在横向（或纵向）上多占的地方，同一侧的其余节点让开
    const after = cy.collection(nodes).boundingBox();
    const cross = axis === "LR" ? "y" : "x";
    const lo = cross === "y" ? before.y1 - after.y1 : before.x1 - after.x1; // 往上（左）多出多少
    const hi = cross === "y" ? after.y2 - before.y2 : after.x2 - before.x2; // 往下（右）多出多少
    const mid = cross === "y" ? (before.y1 + before.y2) / 2 : (before.x1 + before.x2) / 2;
    const inRing = new Set<string>(r.ids);
    for (const id of r.ids) descendants(cy, id, stop).forEach((m: any) => inRing.add(m.id()));
    // 「同一侧」：思维导图左右两边各排各的，只挪环所在那一边（看在不在环的起点同侧）
    const side = (n: any) => Math.sign((axis === "LR" ? n.position("x") : n.position("y")) - (axis === "LR" ? (parent.nonempty() ? parent.position("x") : p0.x - 1) : parent.nonempty() ? parent.position("y") : p0.y - 1));
    const mySide = side(head);
    cy.nodes()
      .not(".note")
      .not(".summary-anchor")
      .forEach((n: any) => {
        if (inRing.has(n.id()) || fixed(n) || n.same(parent)) return;
        if (side(n) !== mySide && side(n) !== 0) return;
        const v = n.position(cross);
        if (v > mid && hi > 0) n.position(cross, v + hi + 16);
        else if (v < mid && lo > 0) n.position(cross, v - lo - 16);
      });
  }
  return moved;
}
