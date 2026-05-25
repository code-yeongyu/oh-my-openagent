import type { PluginInput } from "@opencode-ai/plugin"

/**
 * Known Edit tool error patterns that indicate the AI made a mistake
 */
export const EDIT_ERROR_PATTERNS = [
  "oldString and newString must be different",
  "oldString not found",
  "oldString found multiple times",
] as const

/**
 * System reminder injected when Edit tool fails due to AI mistake
 * Short, direct, and commanding - forces immediate corrective action
 */
export const EDIT_ERROR_REMINDER = `
[编辑错误 - 需要立即处理]

你犯了一个编辑错误。停止并立即执行以下操作：

1. 立即读取文件以查看其实际当前状态
2. 验证内容的真实样子（你的假设是错误的）
3. 向用户简要道歉
4. 基于真实的文件内容继续修正后的操作

在读取并验证文件状态之前，不要尝试再次编辑。
`

/**
 * Detects Edit tool errors caused by AI mistakes and injects a recovery reminder
 *
 * This hook catches common Edit tool failures:
 * - oldString and newString must be different (trying to "edit" to same content)
 * - oldString not found (wrong assumption about file content)
 * - oldString found multiple times (ambiguous match, need more context)
 *
 * @see https://github.com/sst/opencode/issues/4718
 */
export function createEditErrorRecoveryHook(_ctx: PluginInput) {
  return {
    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { title: string; output: string; metadata: unknown }
    ) => {
      if (input.tool.toLowerCase() !== "edit") return
      if (typeof output.output !== "string") return

      const outputLower = (output.output ?? "").toLowerCase()
      const hasEditError = EDIT_ERROR_PATTERNS.some((pattern) =>
        outputLower.includes(pattern.toLowerCase())
      )

      if (hasEditError) {
        output.output += `\n${EDIT_ERROR_REMINDER}`
      }
    },
  }
}
