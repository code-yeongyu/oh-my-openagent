import type { V2McpEditor } from "../context-types"
import type { DesiredConfig } from "./desired-config"

/** Applies the desired MCP servers inside a 2.x MCP transform. */
export function applyDesiredMcp(editor: V2McpEditor, desired: DesiredConfig): void {
  for (const [name, config] of desired.mcp) editor.set(name, config)
}
