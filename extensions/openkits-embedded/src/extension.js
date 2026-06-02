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
const { SYSTEM_PROMPT, callLlm, extractAssistantMessage } = require("../../../packages/openkits-core/src/agent-llm");

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
    this._conversationHistory = [];
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
      // Agent 工具调用（手动）
      if (message.command === "agentTool") {
        const result = await executeAgentTool(message.tool, message.params);
        webviewView.webview.postMessage({ type: "toolResult", tool: message.tool, result });
      }
      // AI 对话
      if (message.command === "chat") {
        await this._handleChat(message.text, webviewView.webview);
      }
      // 清除对话历史
      if (message.command === "clearChat") {
        this._conversationHistory = [];
        webviewView.webview.postMessage({ type: "chatCleared" });
      }
    });
  }

  /**
   * 处理用户发送的聊天消息
   */
  async _handleChat(userText, webview) {
    const config = getConfig();
    const apiKey = config.get("agent.apiKey");
    const endpoint = config.get("agent.apiEndpoint") || "https://api.deepseek.com";
    const model = config.get("agent.model") || "deepseek-v4-pro";

    if (!apiKey) {
      webview.postMessage({
        type: "chatResponse",
        content: "⚠️ 未配置 API Key。请在设置中填写 `openkits.agent.apiKey`。\n\n路径: File → Preferences → Settings → 搜索 \"openkits agent\"",
        done: true,
      });
      return;
    }

    // 添加用户消息到历史
    this._conversationHistory.push({ role: "user", content: userText });

    // 通知 webview 开始思考
    webview.postMessage({ type: "chatThinking" });

    try {
      // 对话循环（支持多轮工具调用）
      let maxRounds = 5;
      while (maxRounds-- > 0) {
        const messages = [
          { role: "system", content: SYSTEM_PROMPT },
          ...this._conversationHistory,
        ];

        const response = await callLlm({ apiKey, endpoint, model, messages });
        const assistant = extractAssistantMessage(response);

        // 如果有工具调用
        if (assistant.toolCalls && assistant.toolCalls.length > 0) {
          // 将助手消息（含 tool_calls）加入历史
          this._conversationHistory.push(assistant.raw);

          // 逐个执行工具
          for (const toolCall of assistant.toolCalls) {
            const toolName = toolCall.function.name;
            let toolParams = {};
            try {
              toolParams = JSON.parse(toolCall.function.arguments || "{}");
            } catch { /* ignore */ }

            webview.postMessage({
              type: "chatToolCall",
              tool: toolName,
              params: toolParams,
            });

            const toolResult = await executeAgentTool(toolName, toolParams);

            // 将工具结果加入历史
            this._conversationHistory.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: JSON.stringify(toolResult),
            });
          }

          // 继续循环让模型生成最终回复
          continue;
        }

        // 没有工具调用，返回文本回复
        this._conversationHistory.push({ role: "assistant", content: assistant.content });
        webview.postMessage({
          type: "chatResponse",
          content: assistant.content,
          done: true,
        });
        break;
      }
    } catch (err) {
      webview.postMessage({
        type: "chatResponse",
        content: `❌ API 调用失败: ${err.message}`,
        done: true,
      });
    }
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
      <div class="header">
        <h2>AI Agent</h2>
        <button class="icon-btn" onclick="clearChat()" title="清除对话">🗑</button>
      </div>
      <div id="messages"></div>
      <div class="input-area">
        <textarea id="input" placeholder="输入你的需求，例如：帮我增加 ADC 采样功能" rows="3"></textarea>
        <button id="sendBtn" onclick="sendChat()">发送</button>
      </div>
      <div class="quick-actions">
        <button onclick="send('build')">编译</button>
        <button onclick="send('flash')">烧录</button>
        <button onclick="callTool('ReadProject')">读取工程</button>
        <button onclick="send('checkToolchain')">检测工具链</button>
      </div>
      <p class="hint">Agent 写操作走 Diff 预览，确认后才写入文件。</p>
    </main>
    <script>
      const vscode = acquireVsCodeApi();

      function send(command) { vscode.postMessage({ command }); }
      function callTool(tool, params) {
        vscode.postMessage({ command: 'agentTool', tool, params: params || {} });
      }

      function sendChat() {
        const input = document.getElementById('input');
        const text = input.value.trim();
        if (!text) return;
        appendMessage('user', text);
        vscode.postMessage({ command: 'chat', text });
        input.value = '';
        document.getElementById('sendBtn').disabled = true;
      }

      function clearChat() {
        vscode.postMessage({ command: 'clearChat' });
        document.getElementById('messages').innerHTML = '';
      }

      // Enter 发送，Shift+Enter 换行
      document.getElementById('input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendChat();
        }
      });

      function appendMessage(role, content) {
        const el = document.getElementById('messages');
        const div = document.createElement('div');
        div.className = 'msg msg-' + role;
        div.textContent = content;
        el.appendChild(div);
        el.scrollTop = el.scrollHeight;
      }

      function appendToolCall(tool, params) {
        const el = document.getElementById('messages');
        const div = document.createElement('div');
        div.className = 'msg msg-tool';
        div.textContent = '🔧 调用工具: ' + tool;
        el.appendChild(div);
        el.scrollTop = el.scrollHeight;
      }

      window.addEventListener('message', (event) => {
        const msg = event.data;
        if (msg.type === 'chatThinking') {
          appendMessage('assistant', '⏳ 思考中...');
        }
        if (msg.type === 'chatResponse') {
          // 移除 "思考中" 提示
          const el = document.getElementById('messages');
          const last = el.lastElementChild;
          if (last && last.textContent === '⏳ 思考中...') {
            el.removeChild(last);
          }
          appendMessage('assistant', msg.content);
          document.getElementById('sendBtn').disabled = false;
        }
        if (msg.type === 'chatToolCall') {
          // 移除 "思考中" 提示
          const el = document.getElementById('messages');
          const last = el.lastElementChild;
          if (last && last.textContent === '⏳ 思考中...') {
            el.removeChild(last);
          }
          appendToolCall(msg.tool, msg.params);
        }
        if (msg.type === 'chatCleared') {
          document.getElementById('messages').innerHTML = '';
        }
        if (msg.type === 'toolResult') {
          const el = document.getElementById('messages');
          const pre = document.createElement('pre');
          pre.className = 'msg msg-tool-result';
          pre.textContent = JSON.stringify(msg.result, null, 2).slice(0, 300);
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
      body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; }
      main { padding: 12px; display: flex; flex-direction: column; gap: 8px; height: 100vh; box-sizing: border-box; }
      h1, h2, p { margin: 0; }
      .header { display: flex; align-items: center; justify-content: space-between; }
      .header h2 { font-size: 14px; }
      .icon-btn { background: none; border: none; color: var(--vscode-foreground); cursor: pointer; font-size: 14px; padding: 4px; }
      #messages { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; min-height: 100px; }
      .msg { padding: 6px 10px; border-radius: 6px; font-size: 13px; white-space: pre-wrap; word-break: break-word; max-width: 95%; }
      .msg-user { background: var(--vscode-button-background); color: var(--vscode-button-foreground); align-self: flex-end; }
      .msg-assistant { background: var(--vscode-textBlockQuote-background); align-self: flex-start; }
      .msg-tool { background: var(--vscode-editorInfo-background, rgba(0,120,212,0.1)); font-size: 12px; align-self: flex-start; opacity: 0.85; }
      .msg-tool-result { background: var(--vscode-textBlockQuote-background); font-size: 11px; align-self: flex-start; margin: 0; overflow-x: auto; }
      .input-area { display: flex; gap: 6px; }
      .input-area textarea { flex: 1; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); padding: 8px; resize: none; font-size: 13px; }
      .input-area button { color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: 0; padding: 8px 14px; cursor: pointer; white-space: nowrap; }
      .input-area button:disabled { opacity: 0.5; cursor: default; }
      .quick-actions { display: flex; flex-wrap: wrap; gap: 4px; }
      .quick-actions button { color: var(--vscode-button-foreground); background: var(--vscode-button-secondaryBackground, var(--vscode-button-background)); border: 0; padding: 4px 8px; cursor: pointer; font-size: 12px; }
      .hint { font-size: 11px; opacity: 0.6; }
      button:hover { opacity: 0.9; }
    </style>
  </head>
  <body>${body}</body>
  </html>`;
}

module.exports = {
  activate,
  deactivate,
};
