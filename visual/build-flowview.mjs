import { build } from "esbuild";

// FlowView 冒烟测试的打包：把 obsidian 换成 visual/obsidian-stub.ts（它转手用 src/web-obsidian.ts），
// 这样 src/main.ts 能在浏览器里真的被实例化。
await build({
  entryPoints: ["visual/flowview.ts"],
  bundle: true,
  format: "iife",
  target: "es2020",
  platform: "browser",
  outfile: "visual/flowview.js",
  alias: { obsidian: "./visual/obsidian-stub.ts" },
  define: { __OUTLINE_FLOW_VIEWER__: '""' },
  loader: { ".css": "text" },
  logLevel: "info",
});
