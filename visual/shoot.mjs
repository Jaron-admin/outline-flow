// 批量截图。用法：node visual/shoot.mjs [用例名...]
// 不传用例名就全拍。产物进 visual/shots/（已 gitignore）。
import { execFileSync } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Chrome 在哪：先看环境变量 CHROME，再按系统找常见的安装位置
const CHROME = [
  process.env.CHROME,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  process.env.LOCALAPPDATA && process.env.LOCALAPPDATA + "/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome",
].find((p) => p && existsSync(p));
if (!CHROME) throw new Error("找不到 Chrome。设一下环境变量 CHROME，指向 Chrome 的可执行文件");

const page = pathToFileURL(resolve("visual/index.html")).href;

// 有两个样本：树状的（结构类全用它）、带回路和概要的（逻辑图/主题用它）
const TREE = [
  "订单系统",
  "  下单",
  "    校验库存",
  "    生成订单",
  "  支付",
  "    微信支付",
  "    支付宝",
  "  发货",
  "    仓库拣货",
  "    物流揽收",
].join("\n");

const FLOW = [
  "用户提交订单【周一上线】",
  "  检查库存",
  "    有货: 扣款",
  "      成功: 发货",
  "        确认收货",
  "      失败: (用户提交订单)",
  "    缺货: 通知用户",
  "      愿意等: 补货",
  "      不等了: 取消订单",
  "  写审计日志",
  "  } 两条收尾",
].join("\n");

const out = "visual/shots";
mkdirSync(out, { recursive: true });

const cases = [
  // 五种新结构 + 逻辑图
  ["mindmap-curve", { structure: "mindmap", line: "curve", src: TREE }],
  ["struct-trunk", { structure: "trunk", src: TREE }],
  ["struct-logic-tree", { structure: "logic", src: TREE }],
  ["struct-org", { structure: "org", src: TREE }],
  ["struct-mindmap", { structure: "mindmap", src: TREE }],
  ["struct-brace", { structure: "brace", src: TREE }],
  ["struct-timeline", { structure: "timeline", src: TREE }],
  ["struct-fishbone", { structure: "fishbone", src: TREE }],
  ["radial-straight", { structure: "radial", line: "straight", src: TREE }],
  ["radial-poly", { structure: "radial", line: "poly", src: TREE }],
  ["radial-curve", { structure: "radial", line: "curve", src: TREE }],
  ["struct-logic", { structure: "logic", src: FLOW }],
  // 三种线型
  ["line-poly", { line: "poly", src: FLOW }],
  ["line-straight", { line: "straight", src: FLOW }],
  ["line-curve", { line: "curve", src: FLOW }],
  // 主题（用逻辑图看边缘情况和备注）
  ["theme-card", { theme: "card", src: FLOW }],
  ["theme-aurora", { theme: "aurora", src: FLOW }],
  ["theme-neon", { theme: "neon", src: FLOW }],
  ["theme-mint", { theme: "mint", src: FLOW }],
  ["theme-sunset", { theme: "sunset", src: FLOW }],
  ["theme-paper", { theme: "paper", src: FLOW }],
  ["theme-mono", { theme: "mono", src: FLOW }],
  ["theme-yellow", { theme: "yellow", src: FLOW }],
  // 结构和主题交叉几条，看渐变根节点在组织结构图里顺不顺眼
  ["mix-org-aurora", { structure: "org", theme: "aurora", src: TREE }],
  ["mix-mindmap-neon", { structure: "mindmap", theme: "neon", src: TREE }],
  ["mix-brace-sunset", { structure: "brace", theme: "sunset", src: TREE }],
  ["mix-timeline-mint", { structure: "timeline", theme: "mint", src: TREE }],
];

const only = new Set(process.argv.slice(2));
let n = 0;
for (const [name, params] of cases) {
  if (only.size && !only.has(name)) continue;
  const q = new URLSearchParams({ ...params, src: params.src }).toString();
  const png = resolve(out, name + ".png");
  execFileSync(CHROME, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--window-size=1280,760",
    "--virtual-time-budget=2500",
    "--screenshot=" + png,
    `${page}?${q}`,
  ]);
  n++;
  console.log("拍了", name);
}
console.log(`${n} 张 -> ${out}`);
