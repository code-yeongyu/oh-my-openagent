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
  "task",
  "call_omo_agent",
  "background_output",
  "session_read",
  "session_search",
  "session_info",
  "session_list",
  "skill",
  "skill_mcp",
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
[JSON PARSE ERROR - IMMEDIATE ACTION REQUIRED]

You sent invalid JSON arguments. The system could not parse your tool call.
STOP and do this NOW:

1. LOOK at the error message above to see what was expected vs what you sent.
2. CORRECT your JSON syntax (missing braces, unescaped quotes, trailing commas, etc).
3. RETRY the tool call with valid JSON.

DO NOT repeat the exact same invalid call.`

/**
 * Options for the JSON error recovery hook.
 */
export interface JsonErrorRecoveryOptions {
  /**
   * Post-repair callback for MetaGovernor. Called when a JSON error is detected
   * and the recovery reminder is injected.
   */
  onRecoveryOutcome?: (outcome: {
    errorCode: string
    fixStrategy: string
    success: boolean
    sessionID: string
    directory: string
    context?: string
  }) => void
}

export function createJsonErrorRecoveryHook(_ctx: PluginInput, options?: JsonErrorRecoveryOptions) {
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

        // Record recovery outcome for MetaGovernor closed-loop learning
        if (options?.onRecoveryOutcome) {
          options.onRecoveryOutcome({
            errorCode: "JSON_PARSE_ERROR",
            fixStrategy: "read-and-retry",
            success: false,
            sessionID: input.sessionID,
            directory: _ctx.directory,
            context: `tool: ${input.tool}`,
          })
        }
      }
    },
  }
}
