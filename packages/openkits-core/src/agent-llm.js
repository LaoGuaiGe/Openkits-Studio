/**
 * OpenKits Agent LLM Client
 *
 * DeepSeek / OpenAI 兼容 API 客户端。
 * 使用 Node 原生 https 模块，不引入第三方依赖。
 */

const https = require("https");
const http = require("http");
const { URL } = require("url");
const { TOOL_DEFINITIONS } = require("./agent-tools");

/**
 * 将 OpenKits 工具定义转为 OpenAI function calling 格式
 */
function buildToolSchemas() {
  return TOOL_DEFINITIONS.map((tool) => {
    const properties = {};
    const required = [];

    for (const [key, def] of Object.entries(tool.parameters)) {
      properties[key] = {
        type: def.type,
        description: def.description,
      };
      if (def.default === undefined) {
        required.push(key);
      }
    }

    return {
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: "object",
          properties,
          required,
        },
      },
    };
  });
}

/**
 * 系统提示词
 */
const SYSTEM_PROMPT = `你是 OpenKits Studio 的嵌入式开发 AI 助手。你帮助用户完成 MSPM0 单片机的开发任务。

你的能力：
- 读取和搜索工程文件
- 提出代码修改（通过 Diff 预览，用户确认后写入）
- 触发编译和分析编译错误
- 检测烧录器并烧录固件

规则：
- 所有代码修改必须通过 ProposePatch 工具提出，用户会在 VS Code Diff 中确认
- 编译和烧录操作需要用户确认
- 回答简洁专业，使用中文
- 如果用户的需求涉及修改代码，先用 ReadProject 或 ReadFile 了解当前代码，再提出修改
- 工程基于 TI MSPM0 平台，使用 DriverLib API`;

/**
 * 调用 LLM API
 * @param {object} options
 * @param {string} options.apiKey
 * @param {string} options.endpoint
 * @param {string} options.model
 * @param {Array} options.messages
 * @param {boolean} options.useTools
 * @returns {Promise<object>}
 */
function callLlm(options) {
  const { apiKey, endpoint, model, messages, useTools = true } = options;

  const url = new URL("/v1/chat/completions", endpoint);
  const isHttps = url.protocol === "https:";

  const body = {
    model,
    messages,
    temperature: 0.3,
    max_tokens: 4096,
  };

  if (useTools) {
    const tools = buildToolSchemas();
    if (tools.length > 0) {
      body.tools = tools;
      body.tool_choice = "auto";
    }
  }

  const payload = JSON.stringify(body);

  const requestOptions = {
    hostname: url.hostname,
    port: url.port || (isHttps ? 443 : 80),
    path: url.pathname,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "Content-Length": Buffer.byteLength(payload),
    },
  };

  return new Promise((resolve, reject) => {
    const client = isHttps ? https : http;
    const req = client.request(requestOptions, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          if (json.error) {
            reject(new Error(json.error.message || JSON.stringify(json.error)));
            return;
          }
          resolve(json);
        } catch (err) {
          reject(new Error(`API 响应解析失败: ${data.slice(0, 200)}`));
        }
      });
    });

    req.on("error", (err) => reject(err));
    req.setTimeout(60000, () => {
      req.destroy();
      reject(new Error("API 请求超时 (60s)"));
    });
    req.write(payload);
    req.end();
  });
}

/**
 * 从 API 响应中提取助手消息
 */
function extractAssistantMessage(response) {
  if (!response.choices || response.choices.length === 0) {
    return { content: "（无响应）", toolCalls: [] };
  }

  const choice = response.choices[0];
  const message = choice.message;

  return {
    content: message.content || "",
    toolCalls: message.tool_calls || [],
    finishReason: choice.finish_reason,
    raw: message,
  };
}

module.exports = {
  SYSTEM_PROMPT,
  buildToolSchemas,
  callLlm,
  extractAssistantMessage,
};
