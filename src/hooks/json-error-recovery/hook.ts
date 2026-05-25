import type { PluginInput } from "@opencode-ai/plugin"

export const JSON_ERROR_TOOL_EXCLUDE_LIST = [
  "bash",
  "read",
  "glob",
  "grep",
  "webfetch",
  "look_at",
  "grep_app_searchgithub",
  "websearch_web_search_exa",
  "todowrite",
  "todoread",
] as const

export const JSON_ERROR_PATTERNS = [
  /json parse error/i,
  /failed to parse json/i,
  /invalid json/i,
  /malformed json/i,
  /unexpected end of json input/i,
  /syntaxerror:\s*unexpected token.*json/i,
  /json[^\n]*expected '\}'/i,
  /json[^\n]*unexpected eof/i,
] as const

const JSON_ERROR_REMINDER_MARKER = "[JSON PARSE ERROR - IMMEDIATE ACTION REQUIRED]"
const JSON_ERROR_EXCLUDED_TOOLS = new Set<string>(JSON_ERROR_TOOL_EXCLUDE_LIST)

export const JSON_ERROR_REMINDER = `
[JSON 解析错误 - 需要立即处理]

你发送了无效的 JSON 参数。系统无法解析你的工具调用。
停止并立即执行以下操作：

1. 查看上面的错误消息，了解期望的内容与你发送的内容之间的差异。
2. 修正你的 JSON 语法（缺少大括号、未转义的引号、尾随逗号等）。
3. 使用有效的 JSON 重试工具调用。

不要重复完全相同无效的调用。
`

export function createJsonErrorRecoveryHook(_ctx: PluginInput) {
  return {
    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { title: string; output: string; metadata: unknown }
    ) => {
      if (JSON_ERROR_EXCLUDED_TOOLS.has(input.tool.toLowerCase())) return
      if (typeof output.output !== "string") return
      if (output.output.includes(JSON_ERROR_REMINDER_MARKER)) return

      const hasJsonError = JSON_ERROR_PATTERNS.some((pattern) => pattern.test(output.output))

      if (hasJsonError) {
        output.output += `\n${JSON_ERROR_REMINDER}`
      }
    },
  }
}
