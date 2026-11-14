// 导出的网页里，拼网页的一边（export.ts）和跑在网页里的脚本（web.ts）要对上的两个 id。
// 单独放一个文件，是为了网页脚本不用把 export.ts 连同样式表一起打进去。

/** 装数据的 script 标签 */
export const DATA_ID = "outline-flow-data";
/** 放图的容器 */
export const CHARTS_ID = "outline-flow-charts";
