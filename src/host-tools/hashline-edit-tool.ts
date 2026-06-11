import type { ToolDefinition } from "@opencode-ai/plugin"
import type { HostKind, HostSessionActions, HostSessionContext, HostToolDefinition, HostToolResult, JsonObject } from "../host-contract"
import { createHashlineEditTool } from "../tools/hashline-edit"
import { createHostToolFromOpenCodeTool, registerTargetTool, type TargetToolDefinition, type TargetToolRegistry } from "./tool-registration"

export type HashlineEditToolOptions = {
  host: Exclude<HostKind, "opencode">
  registry: TargetToolRegistry
  cwd: string
}

function createDetachedSessionContext(cwd: string): HostSessionContext {
  const actions: HostSessionActions = {
    sendUserMessage: async () => {},
    sendInternalMessage: async () => {},
    appendEntry: async () => {},
    getSessionName: () => undefined,
    setSessionName: async () => {},
    getContextUsage: () => undefined,
    compact: async () => {},
    abort: () => {},
    isIdle: () => true,
    hasPendingMessages: () => false,
  }

  return {
    id: "target-session",
    cwd,
    actions,
  }
}

function isHashlineError(result: HostToolResult): boolean {
  const first = result.content[0]
  return first?.type === "text" && first.text.startsWith("Error:")
}

function createTargetHashlineTool(cwd: string, definition: ToolDefinition): HostToolDefinition<JsonObject> {
  const openCodeBackedTool = createHostToolFromOpenCodeTool("edit", definition, {
    directory: cwd,
    worktree: cwd,
  })

  return {
    ...openCodeBackedTool,
    execute: async (request) => {
      const result = await openCodeBackedTool.execute(request)
      return isHashlineError(result) ? { ...result, isError: true } : result
    },
  }
}

export function registerHashlineEditTool(options: HashlineEditToolOptions): TargetToolDefinition {
  const definition = createHashlineEditTool()
  const hostTool = createTargetHashlineTool(options.cwd, definition)

  return registerTargetTool(options.registry, hostTool, {
    host: options.host,
    parameters: { kind: "opencode-args", args: definition.args },
    createSessionContext: () => createDetachedSessionContext(options.cwd),
  })
}
