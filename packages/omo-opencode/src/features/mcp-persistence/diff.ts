export type McpEnabledState = "enabled" | "disabled"

export type McpStateMap = Map<string, McpEnabledState>

export interface McpDiffEntry {
  name: string
  from: McpEnabledState | "unknown"
  to: McpEnabledState
}

export function diffMcpStates(
  runtime: McpStateMap,
  persisted: McpStateMap,
): McpDiffEntry[] {
  const changes: McpDiffEntry[] = []
  for (const [name, runtimeState] of runtime.entries()) {
    const persistedState = persisted.get(name) ?? "unknown"
    if (persistedState !== runtimeState) {
      changes.push({ name, from: persistedState, to: runtimeState })
    }
  }
  return changes
}
