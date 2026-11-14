// 给节点和树上的线标上「属于第几个一级分支（br）」「第几层（dep，中心是 0）」，分支配色的主题照着它上色。
// 树按大纲里的缩进线走（不算引用线、概要、大括号）；一个节点有好几条进来的线时，只认第一条。
// 有好几个起点时，每个起点各自是一层 0，它们的一级分支接着往下编号，颜色不会撞。

export function assignBranches(cy: any): void {
  const tree = cy.edges().not(".ref").not(".summary").not(".brace");
  const nodes = cy.nodes().not(".note").not(".summary-anchor").not(".summary-node");
  const parent = new Map<string, any>();
  tree.forEach((e: any) => {
    const t = e.target().id();
    if (!parent.has(t)) parent.set(t, e);
  });
  const kids = new Map<string, any[]>();
  for (const e of parent.values()) {
    const s = e.source().id();
    if (!kids.has(s)) kids.set(s, []);
    kids.get(s)!.push(e);
  }
  let next = 0;
  const seen = new Set<string>();
  const walk = (n: any, dep: number, br: number) => {
    if (seen.has(n.id())) return;
    seen.add(n.id());
    n.data({ dep, br });
    for (const e of kids.get(n.id()) ?? []) {
      const b = dep === 0 ? next++ : br;
      e.data({ dep: dep + 1, br: b });
      walk(e.target(), dep + 1, b);
    }
  };
  nodes.forEach((n: any) => {
    if (!parent.has(n.id())) walk(n, 0, 0);
  });
  // 环里的节点（没有起点能走到）：当一级分支
  nodes.forEach((n: any) => {
    if (!seen.has(n.id())) walk(n, 1, next++);
  });
}
