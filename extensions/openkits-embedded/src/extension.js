const vscode = require("vscode");
const path = require("path");
const fs = require("fs");
const {
  createMspm0Builder,
  createXds110Flasher,
  ensureProjectManifest,
  getBundledBoards,
  getDefaultRuntimeRoot,
  getMissingRequiredTools,
  inspectToolchain,
  scaffoldProject,
} = require("../../../packages/openkits-core/src");
const agentTools = require("../../../packages/openkits-core/src/agent-tools");

function activate(context) {
  const state = {
    selectedBoardId: getConfig().get("board.default", "tianqiaoxing-mspm0g3519"),
  };

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "openkits.agent",
      new AgentViewProvider(context.extensionUri)
    ),
    vscode.window.registerTreeDataProvider("openkits.boards", new BoardsProvider(state)),
    registerCommand("openkits.showWelcome", () => showWelcome(context.extensionUri)),
    registerCommand("openkits.selectBoard", () => selectBoard(state)),
    registerCommand("openkits.createProject", () => createProject(state)),
    registerCommand("openkits.checkToolchain", () => checkToolchain()),
    registerCommand("openkits.build", () => runBuild()),
    registerCommand("openkits.flash", () => runFlash()),
    registerCommand("openkits.agent.previewAdcPatch", () => previewAdcPatch())
  );

  showWelcome(context.extensionUri);
}

function deactivate() {}

function registerCommand(command, callback) {
  return vscode.commands.registerCommand(command, callback);
}

function getConfig() {
  return vscode.workspace.getConfiguration("openkits");
}

async function showWelcome(extensionUri) {
  const panel = vscode.window.createWebviewPanel(
    "openkitsWelcome",
    "OpenKits Studio",
    vscode.ViewColumn.One,
    { enableScripts: true }
  );

  panel.webview.html = welcomeHtml(panel.webview, extensionUri);
  panel.webview.onDidReceiveMessage(async (message) => {
    if (typeof message.command === "string" && message.command.startsWith("openkits.")) {
      await vscode.commands.executeCommand(message.command);
    }
  });
}

async function selectBoard(state) {
  const boards = getBundledBoards();
  const picked = await vscode.window.showQuickPick(
    boards.map((board) => ({
      label: board.name,
      description: board.family,
      board,
    })),
    { title: "Select OpenKits Board" }
  );

  if (!picked) {
    return;
  }

  state.selectedBoardId = picked.board.id;
  await vscode.window.showInformationMessage(`Selected ${picked.board.name}`);
}

async function createProject(state) {
  const folder = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    canSelectMany: false,
    openLabel: "选择工程目录",
  });

  if (!folder || folder.length === 0) {
    return;
  }

  const projectRoot = folder[0].fsPath;
  const runtimeRoot = getConfig().get("runtime.root") || getDefaultRuntimeRoot();

  const result = scaffoldProject(projectRoot, state.selectedBoardId, runtimeRoot);

  // 显示创建结果
  if (result.fromSdk) {
    await vscode.window.showInformationMessage(result.message);
  } else {
    await vscode.window.showWarningMessage(result.message);
  }

  await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(projectRoot), false);
}

async function checkToolchain() {
  const runtimeRoot = getConfig().get("runtime.root") || getDefaultRuntimeRoot();
  const tools = inspectToolchain(runtimeRoot);
  const missing = getMissingRequiredTools(runtimeRoot);

  const channel = vscode.window.createOutputChannel("OpenKits Toolchain");
  channel.clear();
  channel.appendLine(`Runtime root: ${runtimeRoot}`);
  channel.appendLine("─".repeat(60));

  for (const tool of tools) {
    const status = tool.installed ? "OK" : "MISSING";
    const versionStr = tool.version ? ` (${tool.version})` : "";
    const sourceStr = tool.source ? ` [${tool.source}]` : "";
    channel.appendLine(`[${status}] ${tool.label}${versionStr}${sourceStr}`);
    channel.appendLine(`       路径: ${tool.resolvedPath || tool.expectedPath}`);
    if (!tool.installed && tool.fixHint) {
      channel.appendLine(`       ↳ ${tool.fixHint}`);
    }
    channel.appendLine("");
  }

  channel.show(true);

  if (missing.length === 0) {
    await vscode.window.showInformationMessage("OpenKits 工具链检测通过。所有必需工具均已就绪。");
  } else {
    await vscode.window.showWarningMessage(
      `OpenKits 缺少 ${missing.length} 个必需工具。详情见 Output 面板 "OpenKits Toolchain"。`
    );
  }
}

async function runTask(name, commandLine) {
  const task = new vscode.Task(
    { type: "shell", task: name },
    vscode.TaskScope.Workspace,
    name,
    "OpenKits",
    new vscode.ShellExecution(commandLine)
  );
  task.presentationOptions = {
    reveal: vscode.TaskRevealKind.Always,
    panel: vscode.TaskPanelKind.Shared,
  };
  await vscode.tasks.executeTask(task);
}

/**
 * 读取当前工作区的 .openkits/project.json
 */
function loadProjectManifest() {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return null;
  }
  const projectRoot = workspaceFolders[0].uri.fsPath;
  const manifestPath = path.join(projectRoot, ".openkits", "project.json");
  if (!fs.existsSync(manifestPath)) {
    return null;
  }
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest._projectRoot = projectRoot;
    return manifest;
  } catch {
    return null;
  }
}

/**
 * 解析 gmake 路径：优先 runtime 目录，再尝试系统 PATH
 */
function resolveGmakePath() {
  const runtimeRoot = getConfig().get("runtime.root") || getDefaultRuntimeRoot();
  // CCS 自带的 gmake 通常在 compiler 工具的 utils 目录下
  const runtimeGmake = path.join(runtimeRoot, "compiler", "bin", "gmake.exe");
  if (fs.existsSync(runtimeGmake)) {
    return runtimeGmake;
  }
  // 也可能直接在 ccs 工具目录
  const altGmake = path.join(runtimeRoot, "ccs", "utils", "bin", "gmake.exe");
  if (fs.existsSync(altGmake)) {
    return altGmake;
  }
  // 兜底：系统 PATH 中的 make/gmake
  return "gmake";
}

/**
 * 解析 XDS110 CLI 路径
 */
function resolveXds110Path() {
  const runtimeRoot = getConfig().get("runtime.root") || getDefaultRuntimeRoot();
  const runtimeCli = path.join(runtimeRoot, "xds110", "xdsdfu.exe");
  if (fs.existsSync(runtimeCli)) {
    return runtimeCli;
  }
  // TI DSLite 是更常见的烧录 CLI
  const dslite = path.join(runtimeRoot, "xds110", "dslite.exe");
  if (fs.existsSync(dslite)) {
    return dslite;
  }
  return "dslite";
}

/**
 * 真实 Build 命令
 */
async function runBuild() {
  const manifest = loadProjectManifest();
  if (!manifest) {
    await vscode.window.showWarningMessage(
      "未找到 OpenKits 工程。请先使用 \"OpenKits: Create MSPM0 Project\" 创建工程。"
    );
    return;
  }

  const projectRoot = manifest._projectRoot;
  const configuration = (manifest.build && manifest.build.configuration) || "Debug";
  const gmakePath = resolveGmakePath();

  const builder = createMspm0Builder({
    gmakePath,
    projectRoot,
    configuration,
  });

  const spec = builder.build();
  const commandLine = `"${spec.command}" ${spec.args.join(" ")}`;

  // 用户确认
  const confirm = await vscode.window.showInformationMessage(
    `即将编译工程 (${configuration}):\n${commandLine}`,
    { modal: false },
    "编译",
    "取消"
  );

  if (confirm !== "编译") {
    return;
  }

  const task = new vscode.Task(
    { type: "shell", task: "OpenKits Build" },
    vscode.TaskScope.Workspace,
    "OpenKits Build",
    "OpenKits",
    new vscode.ShellExecution(spec.command, spec.args, { cwd: spec.cwd })
  );
  task.presentationOptions = {
    reveal: vscode.TaskRevealKind.Always,
    panel: vscode.TaskPanelKind.Shared,
  };
  task.group = vscode.TaskGroup.Build;
  await vscode.tasks.executeTask(task);
}

/**
 * 真实 Flash 命令
 */
async function runFlash() {
  const manifest = loadProjectManifest();
  if (!manifest) {
    await vscode.window.showWarningMessage(
      "未找到 OpenKits 工程。请先使用 \"OpenKits: Create MSPM0 Project\" 创建工程。"
    );
    return;
  }

  const projectRoot = manifest._projectRoot;
  const configuration = (manifest.build && manifest.build.configuration) || "Debug";
  const cliPath = resolveXds110Path();

  // 查找固件文件：优先 .out，其次 .hex
  const buildDir = path.join(projectRoot, "ccs", configuration);
  let firmwarePath = null;
  if (fs.existsSync(buildDir)) {
    const files = fs.readdirSync(buildDir);
    const outFile = files.find((f) => f.endsWith(".out"));
    const hexFile = files.find((f) => f.endsWith(".hex"));
    if (outFile) {
      firmwarePath = path.join(buildDir, outFile);
    } else if (hexFile) {
      firmwarePath = path.join(buildDir, hexFile);
    }
  }

  if (!firmwarePath) {
    await vscode.window.showWarningMessage(
      `未找到固件文件。请先编译工程。\n预期路径: ${buildDir}/*.out 或 *.hex`
    );
    return;
  }

  const flasher = createXds110Flasher({
    cliPath,
    projectRoot,
    firmwarePath,
  });

  const spec = flasher.flash();
  const commandLine = `"${spec.command}" ${spec.args.join(" ")}`;

  // 烧录需要用户确认
  const confirm = await vscode.window.showWarningMessage(
    `即将烧录固件到开发板:\n${commandLine}\n\n请确认开发板已连接。`,
    { modal: true },
    "烧录",
    "取消"
  );

  if (confirm !== "烧录") {
    return;
  }

  const task = new vscode.Task(
    { type: "shell", task: "OpenKits Flash" },
    vscode.TaskScope.Workspace,
    "OpenKits Flash",
    "OpenKits",
    new vscode.ShellExecution(spec.command, spec.args, { cwd: spec.cwd })
  );
  task.presentationOptions = {
    reveal: vscode.TaskRevealKind.Always,
    panel: vscode.TaskPanelKind.Shared,
  };
  await vscode.tasks.executeTask(task);
}

async function previewAdcPatch() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    await vscode.window.showWarningMessage("Open a source file before previewing an Agent patch.");
    return;
  }

  const original = editor.document.uri;
  const patchedText = [
    "/* OpenKits Agent preview: ADC sampling scaffold */",
    editor.document.getText(),
    "",
    "static uint16_t openkits_adc_read_sample(void)",
    "{",
    "    return 0;",
    "}",
    "",
  ].join("\n");
  const preview = vscode.Uri.parse(`untitled:${original.fsPath}.openkits-preview`);
  const doc = await vscode.workspace.openTextDocument(preview);
  const edit = new vscode.WorkspaceEdit();
  edit.insert(preview, new vscode.Position(0, 0), patchedText);
  await vscode.workspace.applyEdit(edit);
  await vscode.commands.executeCommand("vscode.diff", original, preview, "OpenKits Agent Preview: ADC Patch");
}

class AgentViewProvider {
  constructor(extensionUri) {
    this.extensionUri = extensionUri;
  }

  resolveWebviewView(webviewView) {
    this._view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
    };
    webviewView.webview.html = agentHtml();
    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (message.command === "previewAdcPatch") {
        await vscode.commands.executeCommand("openkits.agent.previewAdcPatch");
      }
      if (message.command === "checkToolchain") {
        await vscode.commands.executeCommand("openkits.checkToolchain");
      }
      if (message.command === "createProject") {
        await vscode.commands.executeCommand("openkits.createProject");
      }
      if (message.command === "build") {
        await vscode.commands.executeCommand("openkits.build");
      }
      if (message.command === "flash") {
        await vscode.commands.executeCommand("openkits.flash");
      }
      // Agent 工具调用
      if (message.command === "agentTool") {
        const result = await executeAgentTool(message.tool, message.params);
        webviewView.webview.postMessage({ type: "toolResult", tool: message.tool, result });
      }
    });
  }
}

/**
 * Agent 工具调度器 — 接收工具名称和参数，执行对应逻辑
 */
async function executeAgentTool(toolName, params = {}) {
  const projectRoot = getProjectRoot();

  switch (toolName) {
    case "ReadProject":
      return agentTools.readProject(projectRoot);

    case "SearchProject":
      return agentTools.searchProject(projectRoot, params.query, params.glob);

    case "ReadFile":
      return agentTools.readFile(projectRoot, params.filePath);

    case "ProposePatch": {
      if (!projectRoot) return { error: "未打开工程" };
      const intent = agentTools.proposePatch(projectRoot, params.filePath, params.newContent, params.summary);
      if (intent.error) return intent;
      // 执行 Diff 预览
      await showAgentDiff(intent);
      return { status: "diff_shown", summary: intent.summary, filePath: intent.filePath };
    }

    case "RunBuild": {
      await vscode.commands.executeCommand("openkits.build");
      return { status: "build_triggered" };
    }

    case "AnalyzeBuildLog":
      return agentTools.analyzeBuildLog(params.log || "");

    case "DetectProbe": {
      if (!projectRoot) return { error: "未打开工程" };
      const cliPath = resolveXds110Path();
      const spec = { command: cliPath, args: ["--list"], cwd: projectRoot };
      const commandLine = `"${spec.command}" ${spec.args.join(" ")}`;
      const confirm = await vscode.window.showInformationMessage(
        `即将检测烧录器:\n${commandLine}`,
        "检测", "取消"
      );
      if (confirm !== "检测") return { status: "cancelled" };
      await runTask("OpenKits Detect Probe", `${spec.command} ${spec.args.join(" ")}`);
      return { status: "detect_triggered" };
    }

    case "FlashFirmware": {
      await vscode.commands.executeCommand("openkits.flash");
      return { status: "flash_triggered" };
    }

    default:
      return { error: `未知工具: ${toolName}` };
  }
}

/**
 * 获取当前工作区根目录
 */
function getProjectRoot() {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return null;
  return folders[0].uri.fsPath;
}

/**
 * 通过 VS Code Diff 展示 Agent 的修改提案
 */
async function showAgentDiff(intent) {
  const originalUri = vscode.Uri.file(intent.fullPath);
  const previewUri = vscode.Uri.parse(
    `untitled:${intent.fullPath}.openkits-agent-preview`
  );

  const doc = await vscode.workspace.openTextDocument(previewUri);
  const edit = new vscode.WorkspaceEdit();
  // 清空并写入新内容
  const fullRange = new vscode.Range(
    new vscode.Position(0, 0),
    new vscode.Position(doc.lineCount, 0)
  );
  edit.replace(previewUri, fullRange, intent.newContent);
  await vscode.workspace.applyEdit(edit);

  const title = `Agent 修改预览: ${intent.summary || intent.filePath}`;

  if (intent.isNewFile) {
    // 新文件直接显示
    await vscode.window.showTextDocument(doc);
  } else {
    // 已有文件走 Diff
    await vscode.commands.executeCommand("vscode.diff", originalUri, previewUri, title);
  }

  // 提示用户确认
  const action = await vscode.window.showInformationMessage(
    `Agent 提议修改 ${intent.filePath}。确认写入？`,
    "写入", "放弃"
  );

  if (action === "写入") {
    fs.writeFileSync(intent.fullPath, intent.newContent);
    await vscode.window.showInformationMessage(`已写入: ${intent.filePath}`);
  }
}

class BoardsProvider {
  constructor(state) {
    this.state = state;
  }

  getTreeItem(element) {
    return element;
  }

  getChildren() {
    return getBundledBoards().map((board) => {
      const item = new vscode.TreeItem(board.name, vscode.TreeItemCollapsibleState.None);
      item.description = board.id === this.state.selectedBoardId ? "selected" : board.family;
      item.command = {
        command: "openkits.selectBoard",
        title: "Select Board",
      };
      return item;
    });
  }
}

function welcomeHtml() {
  return htmlShell(`
    <main>
      <h1>OpenKits Studio</h1>
      <p>Cursor for Embedded. Reuse VS Code editing, terminal, Git, Diff, and Problems; add AI board workflows.</p>
      <button onclick="run('openkits.selectBoard')">Select Board</button>
      <button onclick="run('openkits.createProject')">Create MSPM0 Project</button>
      <button onclick="run('openkits.checkToolchain')">Check Toolchain</button>
      <button onclick="run('openkits.build')">Build</button>
      <button onclick="run('openkits.flash')">Flash</button>
    </main>
    <script>
      const vscode = acquireVsCodeApi();
      function run(command) { vscode.postMessage({ command }); }
    </script>
  `);
}

function agentHtml() {
  return htmlShell(`
    <main>
      <h2>AI Agent</h2>
      <div id="messages"></div>
      <textarea id="input" placeholder="例如：增加 ADC 采样功能"></textarea>
      <div class="actions">
        <button onclick="send('previewAdcPatch')">ADC Patch Demo</button>
        <button onclick="send('build')">编译</button>
        <button onclick="send('flash')">烧录</button>
        <button onclick="callTool('ReadProject')">读取工程</button>
        <button onclick="callTool('DetectProbe')">检测烧录器</button>
      </div>
      <p class="hint">Agent 写操作走 Diff 预览，确认后才写入文件。</p>
    </main>
    <script>
      const vscode = acquireVsCodeApi();
      function send(command) { vscode.postMessage({ command }); }
      function callTool(tool, params) {
        vscode.postMessage({ command: 'agentTool', tool, params: params || {} });
      }
      window.addEventListener('message', (event) => {
        const msg = event.data;
        if (msg.type === 'toolResult') {
          const el = document.getElementById('messages');
          const pre = document.createElement('pre');
          pre.textContent = '[' + msg.tool + '] ' + JSON.stringify(msg.result, null, 2).slice(0, 500);
          el.appendChild(pre);
          el.scrollTop = el.scrollHeight;
        }
      });
    </script>
  `);
}

function htmlShell(body) {
  return `<!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
      body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); }
      main { padding: 16px; display: flex; flex-direction: column; gap: 10px; }
      h1, h2, p { margin: 0; }
      button { color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: 0; padding: 8px 10px; cursor: pointer; }
      button:hover { background: var(--vscode-button-hoverBackground); }
      textarea { min-height: 88px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); padding: 8px; resize: vertical; }
      .actions { display: flex; flex-wrap: wrap; gap: 6px; }
      .hint { font-size: 12px; opacity: 0.7; }
      #messages { max-height: 200px; overflow-y: auto; font-size: 12px; }
      #messages pre { margin: 4px 0; padding: 6px; background: var(--vscode-textBlockQuote-background); white-space: pre-wrap; word-break: break-all; }
    </style>
  </head>
  <body>${body}</body>
  </html>`;
}

module.exports = {
  activate,
  deactivate,
};
