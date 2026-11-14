import { build } from "esbuild";
await build({
  entryPoints: ["visual/bench.ts"],
  bundle: true, format: "iife", target: "es2020", platform: "browser",
  outfile: "visual/bench.js",
  alias: { obsidian: "./visual/obsidian-stub.ts" },
  logLevel: "error",
});
