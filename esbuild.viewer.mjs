import esbuild from "esbuild";

/**
 * 打网页查看器（导出的网页里跑的那段脚本，入口 src/web.ts）：一段自包含的 IIFE，压缩过，
 * "obsidian" 换成 src/web-obsidian.ts。不写盘，返回脚本文字。
 * 插件构建（esbuild.config.mjs）把它注入成常量，visual/export-sample.mjs 也用它。
 */
export async function buildViewer() {
  const result = await esbuild.build({
    entryPoints: ["src/web.ts"],
    bundle: true,
    format: "iife",
    target: "es2020",
    platform: "browser",
    alias: { obsidian: "./src/web-obsidian.ts" },
    define: { __OUTLINE_FLOW_VIEWER__: '""' }, // 网页自己不再导出网页
    loader: { ".css": "text" },
    minify: true,
    legalComments: "none",
    write: false,
    logLevel: "info",
  });
  return result.outputFiles[0].text;
}
