export const TARGET_SUBAGENT_TYPES = ["explore", "librarian", "oracle", "plan"] as const

export const ENGLISH_DIRECTIVE =
  "**YOU MUST ALWAYS THINK, REASON, AND RESPOND IN ENGLISH REGARDLESS OF THE USER'S QUERY LANGUAGE.**"

export function createDelegateTaskEnglishDirectiveHook() {
  return {
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string; input: Record<string, unknown> },
      _output: { title: string; output: string; metadata: unknown }
    ) => {
      if (input.tool.toLowerCase() !== "task") return

      const args = input.input
      const subagentType = args.subagent_type
      if (typeof subagentType !== "string") return
      if (!TARGET_SUBAGENT_TYPES.includes(subagentType as (typeof TARGET_SUBAGENT_TYPES)[number])) return

      if (typeof args.prompt === "string") {
        args.prompt = `${args.prompt}\n\n${ENGLISH_DIRECTIVE}`
      }
    },
  }
}
