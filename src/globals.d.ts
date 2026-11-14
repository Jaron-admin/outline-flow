/** 构建时由 esbuild 注入：导出网页用的查看器脚本（整段 JS）。网页版本和冒烟测试里是空串。 */
declare const __OUTLINE_FLOW_VIEWER__: string;

/** 样式表当文字读进来（esbuild 的 text 加载器），导出网页时嵌进去 */
declare module "*.css" {
  const css: string;
  export default css;
}
