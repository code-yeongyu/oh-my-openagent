import type { ToolDefinition } from "@opencode-ai/plugin"
import type { Managers } from "../../create-managers"
import type { PluginContext } from "../types"
import { createBackgroundTools, interactive_bash } from "../../tools"

export function createBackgroundAndBashTools(
  backgroundManager: Managers["backgroundManager"],
  client: PluginContext["client"],
  interactiveBashEnabled: boolean,
): Record<string, ToolDefinition> {
  return {
    ...createBackgroundTools(backgroundManager, client),
    ...(interactiveBashEnabled ? { interactive_bash } : {}),
  }
}
