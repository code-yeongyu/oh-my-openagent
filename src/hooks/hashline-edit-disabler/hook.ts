import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { getProvider } from "../../features/hashline-provider-state"
import { EDIT_DISABLED_MESSAGE } from "./constants"

export interface HashlineEditDisablerConfig {
  experimental?: {
    hashline_edit?: boolean
  }
}

export function createHashlineEditDisablerHook(
  config: HashlineEditDisablerConfig,
): Hooks {
  const isHashlineEnabled = config.experimental?.hashline_edit ?? false

  return {
    "tool.execute.before": async (
      input: { tool: string; sessionID: string },
    ) => {
      if (!isHashlineEnabled) {
        return
      }

      const toolName = input.tool.toLowerCase()
      if (toolName !== "edit") {
        return
      }

      const providerID = getProvider(input.sessionID)
      if (providerID === "openai") {
        return
      }

      throw new Error(EDIT_DISABLED_MESSAGE)
    },
  }
}
