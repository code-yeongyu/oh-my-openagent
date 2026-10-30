import type { ToolDefinition } from "@code-yeongyu/senpi"

// Runtime-only provenance: a persisted tool name or a parent's scheduler cannot impersonate
// the engine-created yield wrapper when member tools are reconstructed on cold revival.
const yieldTools = new WeakSet<ToolDefinition>()
export function markWorkpoolYieldTool(tool: ToolDefinition): ToolDefinition { yieldTools.add(tool); return tool }
export function isWorkpoolYieldTool(tool: ToolDefinition): boolean { return yieldTools.has(tool) }
