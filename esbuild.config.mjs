import esbuild from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";
import { buildViewer } from "./esbuild.viewer.mjs";

// 产物放 dist/：main.js、manifest.json、styles.css 三个文件就是一个完整的 Obsidian 插件
mkdirSync("dist", { recursive: true });

// 先打网页查看器（导出的网页里跑的那段脚本，见 esbuild.viewer.mjs），拿到文字后作为常量注入插件，导出时直接嵌进网页
const viewerCode = await buildViewer();

await esbuild.build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  format: "cjs",
  target: "es2020",
  platform: "browser",
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*"],
  define: { __OUTLINE_FLOW_VIEWER__: JSON.stringify(viewerCode) },
  loader: { ".css": "text" },
  outfile: "dist/main.js",
  minify: true,
  legalComments: "eof",
  logLevel: "info",
});

copyFileSync("manifest.json", "dist/manifest.json");
copyFileSync("styles.css", "dist/styles.css");
