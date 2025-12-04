import type { PluginInput } from "@opencode-ai/plugin"

const BLOCKED_MESSAGE =
  "Error: [BLOCKED] grep has no timeout and can freeze the system. " +
  "It is permanently disabled. Use 'safe_grep' instead."

export function createGrepBlocker(_ctx: PluginInput) {
  return {
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      _output: { args: unknown }
    ) => {
      if (input.tool === "grep") {
        throw new Error(BLOCKED_MESSAGE)
      }
    },
  }
}
