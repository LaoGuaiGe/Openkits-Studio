/**
 * OpenKits Toolchain Manager 功能验证脚本
 * 在当前机器上运行工具链检测，验证：
 * - runtime 路径检测
 * - 系统 PATH 兜底（git、node）
 * - 版本号探测
 * - 缺失修复提示
 *
 * 用法: node scripts/test-toolchain.js [自定义 runtimeRoot]
 */

const path = require("path");
const {
  getDefaultRuntimeRoot,
  inspectToolchain,
  getMissingRequiredTools,
} = require("../packages/openkits-core/src");

const customRoot = process.argv[2];
const runtimeRoot = customRoot || getDefaultRuntimeRoot();

console.log("=== OpenKits Toolchain Manager 验证 ===\n");
console.log(`Runtime root: ${runtimeRoot}`);
console.log("─".repeat(60));

const tools = inspectToolchain(runtimeRoot);

for (const tool of tools) {
  const status = tool.installed ? "\x1b[32m[OK]\x1b[0m     " : "\x1b[31m[MISSING]\x1b[0m";
  const versionStr = tool.version ? ` (${tool.version})` : "";
  const sourceStr = tool.source ? ` [来源: ${tool.source}]` : "";
  const requiredStr = tool.required ? "" : " (可选)";

  console.log(`${status} ${tool.label}${requiredStr}${versionStr}${sourceStr}`);
  console.log(`         路径: ${tool.resolvedPath || tool.expectedPath}`);
  if (!tool.installed && tool.fixHint) {
    console.log(`         \x1b[33m↳ ${tool.fixHint}\x1b[0m`);
  }
  console.log("");
}

console.log("─".repeat(60));

const missing = getMissingRequiredTools(runtimeRoot);
if (missing.length === 0) {
  console.log("\x1b[32m✓ 所有必需工具均已就绪。\x1b[0m");
} else {
  console.log(`\x1b[33m⚠ 缺少 ${missing.length} 个必需工具: ${missing.map((t) => t.label).join(", ")}\x1b[0m`);
}

// 验证自定义路径覆盖
console.log("\n--- 自定义路径覆盖验证 ---");
const fakeRoot = path.join(__dirname, "..", "_fake_runtime_test");
const fakeTools = inspectToolchain(fakeRoot);
const gitTool = fakeTools.find((t) => t.id === "git");
if (gitTool && gitTool.source === "PATH" && gitTool.installed) {
  console.log("\x1b[32m✓ 自定义路径不存在时，git 通过 PATH 兜底成功。\x1b[0m");
} else if (gitTool && !gitTool.installed) {
  console.log("\x1b[31m✗ git 未在 PATH 中找到（本机可能未安装 git）。\x1b[0m");
} else {
  console.log(`  git 状态: installed=${gitTool.installed}, source=${gitTool.source}`);
}

const nodeTool = fakeTools.find((t) => t.id === "node");
if (nodeTool && nodeTool.source === "PATH" && nodeTool.installed) {
  console.log("\x1b[32m✓ 自定义路径不存在时，node 通过 PATH 兜底成功。\x1b[0m");
} else if (nodeTool && !nodeTool.installed) {
  console.log("\x1b[31m✗ node 未在 PATH 中找到。\x1b[0m");
}

const sdkTool = fakeTools.find((t) => t.id === "mspm0-sdk");
if (sdkTool && !sdkTool.installed && sdkTool.fixHint) {
  console.log("\x1b[32m✓ MSPM0 SDK 缺失时正确返回修复提示。\x1b[0m");
}

console.log("\n=== 验证完毕 ===");
