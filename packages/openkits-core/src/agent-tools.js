/**
 * OpenKits Agent 最小工具集
 *
 * 每个工具是一个函数，接收参数，返回结构化结果。
 * 所有写操作和命令执行类工具只返回"意图描述"（intent），
 * 由扩展层负责用户确认和实际执行。
 */

const fs = require("fs");
const path = require("path");

/**
 * 工具注册表 — Agent 可调用的工具定义
 */
const TOOL_DEFINITIONS = [
  {
    name: "ReadProject",
    description: "读取当前工程结构、板卡配置和 .openkits/project.json",
    parameters: {},
    requiresApproval: false,
  },
  {
    name: "SearchProject",
    description: "在工程源文件中搜索关键词或正则表达式",
    parameters: {
      query: { type: "string", description: "搜索关键词或正则表达式" },
      glob: { type: "string", description: "文件匹配模式，默认 **/*.{c,h}", default: "**/*.{c,h}" },
    },
    requiresApproval: false,
  },
  {
    name: "ReadFile",
    description: "读取工程中指定文件的内容",
    parameters: {
      filePath: { type: "string", description: "相对于工程根目录的文件路径" },
    },
    requiresApproval: false,
  },
  {
    name: "ProposePatch",
    description: "提出代码修改，通过 VS Code Diff 预览，用户确认后写入",
    parameters: {
      filePath: { type: "string", description: "要修改的文件路径（相对工程根目录）" },
      newContent: { type: "string", description: "修改后的完整文件内容" },
      summary: { type: "string", description: "修改摘要说明" },
    },
    requiresApproval: true,
  },
  {
    name: "RunBuild",
    description: "触发工程编译",
    parameters: {
      configuration: { type: "string", description: "编译配置，默认 Debug", default: "Debug" },
    },
    requiresApproval: true,
  },
  {
    name: "AnalyzeBuildLog",
    description: "分析编译日志，提取错误和警告信息",
    parameters: {
      log: { type: "string", description: "编译输出日志内容" },
    },
    requiresApproval: false,
  },
  {
    name: "DetectProbe",
    description: "检测已连接的调试/烧录器（XDS110、J-Link）",
    parameters: {},
    requiresApproval: true,
  },
  {
    name: "FlashFirmware",
    description: "将编译产物烧录到开发板",
    parameters: {
      firmwarePath: { type: "string", description: "固件文件路径（可选，默认自动查找）", default: null },
    },
    requiresApproval: true,
  },
];

/**
 * ReadProject — 读取工程结构
 */
function readProject(projectRoot) {
  if (!projectRoot || !fs.existsSync(projectRoot)) {
    return { error: "工程目录不存在" };
  }

  const result = {
    projectRoot,
    manifest: null,
    fileTree: [],
  };

  // 读取 .openkits/project.json
  const manifestPath = path.join(projectRoot, ".openkits", "project.json");
  if (fs.existsSync(manifestPath)) {
    try {
      result.manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch {
      result.manifest = null;
    }
  }

  // 构建文件树（限制深度 3，排除 node_modules 等）
  result.fileTree = buildFileTree(projectRoot, 3);

  return result;
}

/**
 * 构建文件树
 */
function buildFileTree(dir, maxDepth, currentDepth = 0, prefix = "") {
  if (currentDepth >= maxDepth) return [];

  const IGNORE = new Set(["node_modules", ".git", ".openkits", "ccs"]);
  const entries = [];

  try {
    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
      if (IGNORE.has(item.name) && currentDepth === 0) continue;
      const relativePath = prefix ? `${prefix}/${item.name}` : item.name;

      if (item.isDirectory()) {
        entries.push({ path: relativePath, type: "dir" });
        const children = buildFileTree(
          path.join(dir, item.name),
          maxDepth,
          currentDepth + 1,
          relativePath
        );
        entries.push(...children);
      } else {
        entries.push({ path: relativePath, type: "file" });
      }
    }
  } catch {
    // permission errors etc.
  }

  return entries;
}

/**
 * SearchProject — 在工程文件中搜索
 */
function searchProject(projectRoot, query, glob = "**/*.{c,h}") {
  if (!projectRoot || !fs.existsSync(projectRoot)) {
    return { error: "工程目录不存在" };
  }

  const results = [];
  const regex = new RegExp(query, "gi");
  const files = collectFiles(projectRoot, glob);

  for (const filePath of files) {
    try {
      const content = fs.readFileSync(filePath, "utf8");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          results.push({
            file: path.relative(projectRoot, filePath),
            line: i + 1,
            content: lines[i].trimEnd(),
          });
          regex.lastIndex = 0;
        }
      }
    } catch {
      // skip unreadable files
    }

    if (results.length >= 50) break; // 限制结果数量
  }

  return { query, matchCount: results.length, results };
}

/**
 * 收集匹配 glob 模式的文件（简化实现）
 */
function collectFiles(dir, globPattern) {
  const files = [];
  // 从 glob 提取扩展名
  const extMatch = globPattern.match(/\*\.(\{[^}]+\}|[a-z]+)/i);
  let extensions = null;
  if (extMatch) {
    const ext = extMatch[1];
    if (ext.startsWith("{")) {
      extensions = ext.slice(1, -1).split(",").map((e) => "." + e.trim());
    } else {
      extensions = ["." + ext];
    }
  }

  function walk(currentDir) {
    try {
      const items = fs.readdirSync(currentDir, { withFileTypes: true });
      for (const item of items) {
        if (item.name.startsWith(".") || item.name === "node_modules") continue;
        const fullPath = path.join(currentDir, item.name);
        if (item.isDirectory()) {
          walk(fullPath);
        } else if (!extensions || extensions.includes(path.extname(item.name))) {
          files.push(fullPath);
        }
      }
    } catch {
      // skip
    }
  }

  walk(dir);
  return files;
}

/**
 * ReadFile — 读取指定文件
 */
function readFile(projectRoot, filePath) {
  const fullPath = path.resolve(projectRoot, filePath);

  // 安全检查：不允许读取工程目录外的文件
  if (!fullPath.startsWith(projectRoot)) {
    return { error: "不允许读取工程目录外的文件" };
  }

  if (!fs.existsSync(fullPath)) {
    return { error: `文件不存在: ${filePath}` };
  }

  try {
    const content = fs.readFileSync(fullPath, "utf8");
    const stat = fs.statSync(fullPath);
    return {
      filePath,
      size: stat.size,
      lines: content.split("\n").length,
      content,
    };
  } catch (err) {
    return { error: `读取失败: ${err.message}` };
  }
}

/**
 * ProposePatch — 提出代码修改（返回 intent，由扩展层执行 Diff 预览）
 */
function proposePatch(projectRoot, filePath, newContent, summary) {
  const fullPath = path.resolve(projectRoot, filePath);

  if (!fullPath.startsWith(projectRoot)) {
    return { error: "不允许修改工程目录外的文件" };
  }

  const originalExists = fs.existsSync(fullPath);
  let originalContent = "";
  if (originalExists) {
    originalContent = fs.readFileSync(fullPath, "utf8");
  }

  return {
    type: "intent",
    action: "ProposePatch",
    requiresApproval: true,
    filePath,
    fullPath,
    isNewFile: !originalExists,
    originalContent,
    newContent,
    summary,
  };
}

/**
 * RunBuild — 返回编译 intent
 */
function runBuild(projectRoot, configuration = "Debug") {
  return {
    type: "intent",
    action: "RunBuild",
    requiresApproval: true,
    projectRoot,
    configuration,
  };
}

/**
 * AnalyzeBuildLog — 解析编译日志
 */
function analyzeBuildLog(log) {
  const errors = [];
  const warnings = [];
  const lines = log.split("\n");

  for (const line of lines) {
    // TI ARM Clang 格式: "file.c:10:5: error: ..."
    // GCC 格式: "file.c:10:5: error: ..."
    const errorMatch = line.match(/^(.+?):(\d+):(\d+):\s*error:\s*(.+)/);
    if (errorMatch) {
      errors.push({
        file: errorMatch[1],
        line: parseInt(errorMatch[2], 10),
        column: parseInt(errorMatch[3], 10),
        message: errorMatch[4].trim(),
      });
      continue;
    }

    const warnMatch = line.match(/^(.+?):(\d+):(\d+):\s*warning:\s*(.+)/);
    if (warnMatch) {
      warnings.push({
        file: warnMatch[1],
        line: parseInt(warnMatch[2], 10),
        column: parseInt(warnMatch[3], 10),
        message: warnMatch[4].trim(),
      });
      continue;
    }

    // 链接器错误: "undefined reference to ..."
    const linkerMatch = line.match(/undefined reference to [`'](.+?)'/);
    if (linkerMatch) {
      errors.push({
        file: null,
        line: null,
        column: null,
        message: `链接错误: undefined reference to '${linkerMatch[1]}'`,
      });
    }
  }

  return {
    errorCount: errors.length,
    warningCount: warnings.length,
    errors,
    warnings,
    buildSuccess: errors.length === 0,
  };
}

/**
 * DetectProbe — 返回探测 intent
 */
function detectProbe(projectRoot) {
  return {
    type: "intent",
    action: "DetectProbe",
    requiresApproval: true,
    projectRoot,
  };
}

/**
 * FlashFirmware — 返回烧录 intent
 */
function flashFirmware(projectRoot, firmwarePath = null) {
  return {
    type: "intent",
    action: "FlashFirmware",
    requiresApproval: true,
    projectRoot,
    firmwarePath,
  };
}

module.exports = {
  TOOL_DEFINITIONS,
  readProject,
  searchProject,
  readFile,
  proposePatch,
  runBuild,
  analyzeBuildLog,
  detectProbe,
  flashFirmware,
};
