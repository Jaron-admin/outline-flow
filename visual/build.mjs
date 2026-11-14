import { build } from "esbuild";

await build({
  entryPoints: ["visual/driver.ts"],
  bundle: true,
  format: "iife",
  target: "es2020",
  platform: "browser",
  outfile: "visual/driver.js",
  logLevel: "info",
});
