const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const product = readJson("product/openkits.product.json");
assert(product.nameShort === "OpenKits Studio", "product nameShort must be OpenKits Studio");
assert(product.applicationName === "openkits-studio", "product applicationName must be openkits-studio");

const extension = readJson("extensions/openkits-embedded/package.json");
const commands = new Set(extension.contributes.commands.map((command) => command.command));
[
  "openkits.showWelcome",
  "openkits.selectBoard",
  "openkits.createProject",
  "openkits.checkToolchain",
  "openkits.build",
  "openkits.flash",
  "openkits.agent.previewAdcPatch",
].forEach((command) => assert(commands.has(command), `missing command ${command}`));

assert(extension.contributes.views.openkits.some((view) => view.id === "openkits.agent"), "missing AI Agent view");
assert(extension.contributes.views.openkits.some((view) => view.id === "openkits.boards"), "missing Boards view");

const board = readJson("packages/openkits-core/boards/tianqiaoxing-mspm0g3519/board.json");
assert(board.family === "MSPM0", "MVP board must be MSPM0");
assert(board.buildAdapter === "mspm0-ccs-gmake", "MVP build adapter must use CCS gmake");
assert(board.flashAdapter === "xds110", "MVP flash adapter must prefer XDS110");

const core = readText("packages/openkits-core/src/index.js");
[
  "createMspm0Builder",
  "createXds110Flasher",
  "inspectToolchain",
  "ensureProjectManifest",
].forEach((symbol) => assert(core.includes(symbol), `missing core symbol ${symbol}`));

const extensionSource = readText("extensions/openkits-embedded/src/extension.js");
assert(extensionSource.includes("vscode.diff"), "Agent preview must use VS Code Diff");
assert(extensionSource.includes("registerWebviewViewProvider"), "extension must register AI webview");
assert(extensionSource.includes("registerTreeDataProvider"), "extension must register Boards tree");

const agentTools = readText("packages/openkits-core/src/agent-tools.js");
[
  "readProject",
  "searchProject",
  "readFile",
  "proposePatch",
  "runBuild",
  "analyzeBuildLog",
  "detectProbe",
  "flashFirmware",
].forEach((symbol) => assert(agentTools.includes(symbol), `missing agent tool ${symbol}`));

console.log("OpenKits Studio MVP scaffold validation passed.");
