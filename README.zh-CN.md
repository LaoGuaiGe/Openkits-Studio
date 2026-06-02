# OpenKits Studio

**嵌入式 AI 开发工作室** — 基于 VS Code OSS 构建的 "Cursor for Embedded"。

OpenKits Studio 复用 VS Code 成熟能力（编辑器、文件树、终端、Git、Diff、Problems、命令面板），在此基础上增加嵌入式特有的 AI 工作流：开发板选择、工程创建、工具链管理、编译、烧录，以及 Diff-first 的 AI Agent。

它不是 Keil 替代品，不是 CCS 替代品，也不是重新开发的编辑器。

## MVP 范围

- Windows 优先
- MSPM0 优先
- 首选开发板：天巧星 MSPM0G3519
- 编译：CCS compiler / gmake
- 烧录：XDS110
- 所有 AI 文件修改必须经过 VS Code Diff 确认后才写入

## 功能

### 工具链管理
- 检测 Git、Node.js、MSPM0 SDK、CCS 编译器（TI ARM Clang）、XDS110、J-Link
- 支持安装包自带的 runtime 目录和系统 PATH 兜底
- 显示版本信息，缺失时给出修复提示

### 工程创建
- SDK 存在时从 SDK example 拷贝创建工程
- SDK 不存在时创建最小占位工程并提示安装
- 自动生成 `.openkits/project.json` 配置和 CCS Makefile 结构

### 编译 & 烧录
- 真实 CCS gmake 编译集成，带用户确认
- XDS110 烧录，自动查找固件文件（`.out` / `.hex`）
- 所有破坏性操作需要用户明确确认

### AI Agent 工具集
| 工具 | 说明 | 需确认 |
|------|------|--------|
| ReadProject | 读取工程结构和配置 | 否 |
| SearchProject | 按关键词/正则搜索源文件 | 否 |
| ReadFile | 读取指定文件内容 | 否 |
| ProposePatch | 通过 VS Code Diff 提出代码修改 | 是 |
| RunBuild | 触发编译 | 是 |
| AnalyzeBuildLog | 解析编译错误和警告 | 否 |
| DetectProbe | 检测已连接的调试/烧录器 | 是 |
| FlashFirmware | 烧录固件到开发板 | 是 |

## 目录结构

```
product/              VS Code OSS 品牌配置和默认设置
extensions/           OpenKits VS Code 扩展
  openkits-embedded/    开发板、工具链、编译、烧录、AI Agent
packages/             核心逻辑包
  openkits-core/        板卡包、工具链、编译/烧录适配器、Agent 工具集
scripts/              校验和测试脚本
docs/                 实现文档和验收标准
```

## 快速开始（开发模式）

1. 用 VS Code 打开本仓库
2. 按 `F5` 启动 Extension Development Host
3. 在新窗口中按 `Ctrl+Shift+P`，输入 `OpenKits`

## 验证

```bash
node scripts/validate-mvp.js
node scripts/test-toolchain.js
```

## 架构

三层设计：

1. **VS Code OSS 发行版** — 品牌定制，现有 workbench 保持不变
2. **OpenKits 扩展** — 开发板选择、工程创建、AI Agent 聊天、Diff-first 修改预览、编译/烧录命令
3. **OpenKits Agent 引擎** — 嵌入式专用工具注册表、工作区权限限制、人工审批门控

## 许可证

MIT
