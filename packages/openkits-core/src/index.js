const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");

const BOARD_MSPM0G3519 = {
  id: "tianqiaoxing-mspm0g3519",
  name: "Tianqiaoxing MSPM0G3519",
  family: "MSPM0",
  vendor: "OpenKits",
  sdk: {
    name: "MSPM0 SDK",
    exampleRootHint:
      "examples/nortos/LP_MSPM0G3519/driverlib/empty",
  },
  build: {
    adapter: "mspm0-ccs-gmake",
    defaultConfiguration: "Debug",
  },
  flash: {
    adapter: "xds110",
    preferredProbe: "XDS110",
  },
};

function getDefaultRuntimeRoot() {
  return path.join(os.homedir(), ".openkits-studio", "runtime");
}

function getBundledBoards() {
  return [BOARD_MSPM0G3519];
}

function getBoard(boardId) {
  const board = getBundledBoards().find((item) => item.id === boardId);
  if (!board) {
    throw new Error(`Unknown OpenKits board: ${boardId}`);
  }
  return board;
}

function createProjectManifest(boardId, sdkVersion = "unknown") {
  const board = getBoard(boardId);
  return {
    schemaVersion: 1,
    board,
    sdkVersion,
    build: {
      adapter: board.build.adapter,
      configuration: board.build.defaultConfiguration,
    },
    flash: {
      adapter: board.flash.adapter,
      probe: board.flash.preferredProbe,
    },
    agent: {
      requireDiffApproval: true,
    },
  };
}

function ensureProjectManifest(projectRoot, boardId, sdkVersion) {
  const openkitsDir = path.join(projectRoot, ".openkits");
  fs.mkdirSync(openkitsDir, { recursive: true });
  const manifestPath = path.join(openkitsDir, "project.json");
  const manifest = createProjectManifest(boardId, sdkVersion);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return { manifestPath, manifest };
}

// --- Toolchain Manager (Enhanced) ---

/**
 * 修复提示：每个工具缺失时的用户提示信息
 */
const TOOL_FIX_HINTS = {
  git: "此工具由 OpenKits Studio 安装包自带。如缺失请重新安装 OpenKits Studio，或从 https://git-scm.com 下载便携版并配置路径。",
  node: "此工具由 OpenKits Studio 安装包自带。如缺失请重新安装 OpenKits Studio，或从 https://nodejs.org 下载 LTS 版本。",
  "mspm0-sdk": "MSPM0 SDK 由 OpenKits Studio 安装包自带。如缺失请重新安装，或从 TI 官网下载 SDK 后在设置中指定 openkits.runtime.root。",
  "ccs-compiler": "TI ARM Clang 编译器由安装包自带。如缺失请重新安装 OpenKits Studio，或安装 CCS 后在设置中指定路径。",
  xds110: "XDS110 烧录工具由安装包自带。如缺失请重新安装 OpenKits Studio，或安装 TI UniFlash 后在设置中指定路径。",
  jlink: "J-Link 为可选工具。如需使用请从 SEGGER 官网下载安装：https://www.segger.com/downloads/jlink/",
};

/**
 * 工具链检查定义
 */
function toolchainChecks(runtimeRoot = getDefaultRuntimeRoot()) {
  return [
    {
      id: "git",
      label: "Git",
      expectedPath: path.join(runtimeRoot, "git", "cmd", "git.exe"),
      pathFallbackCmd: "git",
      versionArgs: ["--version"],
      versionParser: (output) => output.replace("git version", "").trim(),
      required: true,
    },
    {
      id: "node",
      label: "Node.js",
      expectedPath: path.join(runtimeRoot, "node", "node.exe"),
      pathFallbackCmd: "node",
      versionArgs: ["--version"],
      versionParser: (output) => output.trim(),
      required: true,
    },
    {
      id: "mspm0-sdk",
      label: "MSPM0 SDK",
      expectedPath: path.join(runtimeRoot, "sdk", "mspm0"),
      pathFallbackCmd: null,
      versionArgs: null,
      versionParser: null,
      required: true,
    },
    {
      id: "ccs-compiler",
      label: "CCS Compiler (TI ARM Clang)",
      expectedPath: path.join(runtimeRoot, "compiler"),
      pathFallbackCmd: null,
      versionArgs: null,
      versionParser: null,
      required: true,
    },
    {
      id: "xds110",
      label: "XDS110",
      expectedPath: path.join(runtimeRoot, "xds110"),
      pathFallbackCmd: null,
      versionArgs: null,
      versionParser: null,
      required: true,
    },
    {
      id: "jlink",
      label: "J-Link",
      expectedPath: path.join(runtimeRoot, "jlink"),
      pathFallbackCmd: "JLink",
      versionArgs: null,
      versionParser: null,
      required: false,
    },
  ];
}

/**
 * 尝试通过系统 PATH 找到可执行文件并获取版本
 */
function probeFromPath(cmd, versionArgs, versionParser) {
  if (!cmd) return null;
  try {
    if (versionArgs) {
      const output = execFileSync(cmd, versionArgs, {
        encoding: "utf8",
        timeout: 5000,
        windowsHide: true,
      });
      const version = versionParser ? versionParser(output) : output.trim();
      return { found: true, version, source: "PATH" };
    }
    // 没有 versionArgs 就只探测是否能执行
    execFileSync(cmd, ["--version"], {
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
    });
    return { found: true, version: null, source: "PATH" };
  } catch {
    return null;
  }
}

/**
 * 尝试从 runtime 路径下获取工具版本
 */
function probeVersion(exePath, versionArgs, versionParser) {
  if (!versionArgs || !fs.existsSync(exePath)) return null;
  try {
    const output = execFileSync(exePath, versionArgs, {
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
    });
    return versionParser ? versionParser(output) : output.trim();
  } catch {
    return null;
  }
}

/**
 * 完整工具链检测
 * - 优先检查 runtime 目录
 * - 不存在则尝试系统 PATH 兜底（仅 git、node 等通用工具）
 * - 获取版本号
 * - 缺失时附带修复提示
 */
function inspectToolchain(runtimeRoot = getDefaultRuntimeRoot()) {
  return toolchainChecks(runtimeRoot).map((check) => {
    const runtimeExists = fs.existsSync(check.expectedPath);
    let resolvedPath = null;
    let version = null;
    let source = null;

    if (runtimeExists) {
      resolvedPath = check.expectedPath;
      source = "runtime";
      version = probeVersion(check.expectedPath, check.versionArgs, check.versionParser);
    } else if (check.pathFallbackCmd) {
      const probe = probeFromPath(check.pathFallbackCmd, check.versionArgs, check.versionParser);
      if (probe && probe.found) {
        resolvedPath = check.pathFallbackCmd;
        version = probe.version;
        source = "PATH";
      }
    }

    const installed = resolvedPath !== null;

    return {
      id: check.id,
      label: check.label,
      expectedPath: check.expectedPath,
      resolvedPath,
      version,
      source,
      installed,
      required: check.required,
      fixHint: installed ? null : (TOOL_FIX_HINTS[check.id] || null),
    };
  });
}

function getMissingRequiredTools(runtimeRoot = getDefaultRuntimeRoot()) {
  return inspectToolchain(runtimeRoot).filter(
    (tool) => tool.required && !tool.installed
  );
}

function createMspm0Builder(options) {
  const { gmakePath, projectRoot, configuration = "Debug" } = options;
  const buildDirectory = path.join(projectRoot, "ccs", configuration);

  return {
    id: "mspm0-ccs-gmake",
    build() {
      return {
        command: gmakePath,
        args: ["-C", buildDirectory, "all"],
        cwd: projectRoot,
      };
    },
    clean() {
      return {
        command: gmakePath,
        args: ["-C", buildDirectory, "clean"],
        cwd: projectRoot,
      };
    },
    rebuild() {
      return {
        command: gmakePath,
        args: ["-C", buildDirectory, "clean", "all"],
        cwd: projectRoot,
      };
    },
  };
}

function createXds110Flasher(options) {
  const { cliPath, projectRoot, firmwarePath } = options;
  return {
    id: "xds110",
    detect() {
      return {
        command: cliPath,
        args: ["--list"],
        cwd: projectRoot,
      };
    },
    flash() {
      return {
        command: cliPath,
        args: ["--flash", firmwarePath],
        cwd: projectRoot,
      };
    },
    verify() {
      return {
        command: cliPath,
        args: ["--verify", firmwarePath],
        cwd: projectRoot,
      };
    },
  };
}

// --- Project Scaffolding ---

/**
 * 递归拷贝目录
 */
function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * 检测 SDK 路径是否存在，并尝试读取版本
 */
function detectSdk(runtimeRoot = getDefaultRuntimeRoot()) {
  const sdkRoot = path.join(runtimeRoot, "sdk", "mspm0");
  if (!fs.existsSync(sdkRoot)) {
    return { exists: false, sdkRoot, version: "unknown" };
  }
  // 尝试从 SDK 根目录的 manifest 或版本文件读取版本
  const versionFiles = ["sdk_manifest.json", "version.txt", "SDK_VERSION"];
  let version = "unknown";
  for (const vf of versionFiles) {
    const vfPath = path.join(sdkRoot, vf);
    if (fs.existsSync(vfPath)) {
      try {
        const content = fs.readFileSync(vfPath, "utf8");
        if (vf.endsWith(".json")) {
          const json = JSON.parse(content);
          version = json.version || json.sdk_version || "unknown";
        } else {
          version = content.trim().split("\n")[0];
        }
        break;
      } catch {
        // ignore
      }
    }
  }
  return { exists: true, sdkRoot, version };
}

/**
 * 从 SDK example 拷贝创建工程
 * @returns {{ fromSdk: boolean, sdkVersion: string, message: string }}
 */
function scaffoldProject(projectRoot, boardId, runtimeRoot = getDefaultRuntimeRoot()) {
  const board = getBoard(boardId);
  const sdk = detectSdk(runtimeRoot);

  const srcDir = path.join(projectRoot, "src");
  const includeDir = path.join(projectRoot, "include");
  const ccsDir = path.join(projectRoot, "ccs", "Debug");

  fs.mkdirSync(srcDir, { recursive: true });
  fs.mkdirSync(includeDir, { recursive: true });
  fs.mkdirSync(ccsDir, { recursive: true });

  let fromSdk = false;
  let message = "";

  if (sdk.exists && board.sdk && board.sdk.exampleRootHint) {
    const exampleDir = path.join(sdk.sdkRoot, board.sdk.exampleRootHint);
    if (fs.existsSync(exampleDir)) {
      // 从 SDK example 拷贝文件
      copyDirSync(exampleDir, projectRoot);
      fromSdk = true;
      message = `工程已从 SDK example 创建 (${board.sdk.exampleRootHint})。`;
    } else {
      // SDK 存在但 example 路径不存在
      createMinimalSource(srcDir, board);
      message = `SDK 已安装但未找到 example (${board.sdk.exampleRootHint})。已创建最小工程。`;
    }
  } else {
    // SDK 不存在，创建最小占位工程
    createMinimalSource(srcDir, board);
    message = "未检测到 MSPM0 SDK。已创建最小占位工程。请安装 SDK 后重新创建，或在设置中指定 openkits.runtime.root。";
  }

  // 生成 CCS Makefile 占位
  const makefilePath = path.join(ccsDir, "makefile");
  if (!fs.existsSync(makefilePath)) {
    fs.writeFileSync(makefilePath, generateMinimalMakefile(board, projectRoot));
  }

  // 生成 .openkits/project.json
  const { manifestPath, manifest } = ensureProjectManifest(projectRoot, boardId, sdk.version);

  return {
    fromSdk,
    sdkVersion: sdk.version,
    message,
    manifestPath,
    manifest,
  };
}

/**
 * 创建最小占位源文件
 */
function createMinimalSource(srcDir, board) {
  const mainPath = path.join(srcDir, "main.c");
  if (!fs.existsSync(mainPath)) {
    fs.writeFileSync(
      mainPath,
      [
        "/*",
        ` * OpenKits Studio - ${board.name}`,
        " * 最小工程模板",
        " */",
        "",
        "#include <ti/devices/msp/msp.h>",
        "#include <ti/driverlib/driverlib.h>",
        "",
        "int main(void)",
        "{",
        "    SYSCFG_DL_init();",
        "",
        "    while (1) {",
        "        __WFI();",
        "    }",
        "}",
        "",
      ].join("\n")
    );
  }
}

/**
 * 生成最小 CCS Makefile 占位
 */
function generateMinimalMakefile(board, projectRoot) {
  const projectName = path.basename(projectRoot);
  return [
    `# OpenKits Studio - CCS Build Makefile`,
    `# Board: ${board.name}`,
    `# MCU: ${board.id}`,
    `# 此文件为占位 Makefile，完整构建需要 CCS compiler 和 MSPM0 SDK`,
    ``,
    `PROJECT_NAME := ${projectName}`,
    `CONFIGURATION := Debug`,
    ``,
    `# SDK 和编译器路径（由 OpenKits runtime 提供）`,
    `# MSPM0_SDK_INSTALL_DIR ?= `,
    `# TI_ARM_CLANG_DIR ?= `,
    ``,
    `all:`,
    `\t@echo "OpenKits Build: $(PROJECT_NAME) [$(CONFIGURATION)]"`,
    `\t@echo "请确保 CCS Compiler 和 MSPM0 SDK 已安装。"`,
    ``,
    `clean:`,
    `\t@echo "Clean $(PROJECT_NAME)"`,
    ``,
  ].join("\n");
}

module.exports = {
  BOARD_MSPM0G3519,
  copyDirSync,
  createMinimalSource,
  createMspm0Builder,
  createProjectManifest,
  createXds110Flasher,
  detectSdk,
  ensureProjectManifest,
  getBoard,
  getBundledBoards,
  getDefaultRuntimeRoot,
  getMissingRequiredTools,
  inspectToolchain,
  scaffoldProject,
  toolchainChecks,
};
