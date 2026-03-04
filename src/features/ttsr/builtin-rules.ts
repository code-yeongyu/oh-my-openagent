import type { TtsrRule } from "./types"

const MULTI_TOOL_USE_PARALLEL_RULE: TtsrRule = {
  name: "multi-tool-use-parallel",
  condition: ["multi_tool_use\\.parallel"],
  scope: ["text"],
  content: `Do NOT use "multi_tool_use.parallel". It is not a real tool in this environment.
Instead, make individual tool calls sequentially, or use the task delegation system for parallel work.
Each tool call must be a separate, properly formatted tool invocation.`,
}

export function createBuiltinTtsrRules(): TtsrRule[] {
  return [MULTI_TOOL_USE_PARALLEL_RULE]
}
