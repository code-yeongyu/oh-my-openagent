import type { ToolDefinition } from "@opencode-ai/plugin"
import type { PluginContext } from "../types"
import {
  builtinTools,
  createGrepTools,
  createGlobTools,
  createAstGrepTools,
  createSessionManagerTools,
} from "../../tools"

export function createSearchAndSessionTools(ctx: PluginContext): Record<string, ToolDefinition> {
  return {
    ...builtinTools,
    ...createGrepTools(ctx),
    ...createGlobTools(ctx),
    ...createAstGrepTools(ctx),
    ...createSessionManagerTools(ctx),
  }
}
