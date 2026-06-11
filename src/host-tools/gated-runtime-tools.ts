import type { HostKind, HostSessionActions, HostSessionContext, HostToolDefinition, HostToolResult, JsonObject } from "../host-contract"
import { isInteractiveBashEnabled } from "../create-runtime-tmux-config"
import { interactive_bash } from "../tools/interactive-bash"
import { registerTargetLookAtTool } from "./look-at-tool"
import { createHostToolFromOpenCodeTool, registerTargetTool, type TargetToolDefinition, type TargetToolRegistry } from "./tool-registration"

export type GatedRuntimeToolsOptions = {
  host: Exclude<HostKind, "opencode">
  registry: TargetToolRegistry
  cwd: string
  interactiveBashEnabled?: boolean
}

export type GatedRuntimeToolsResult = {
  tools: readonly TargetToolDefinition[]
  unsupported: readonly string[]
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

  return { id: "target-session", cwd, actions }
}

function marksError(result: HostToolResult): boolean {
  const first = result.content[0]
  return first?.type === "text" && first.text.startsWith("Error:")
}

function createInteractiveBashHostTool(cwd: string): HostToolDefinition<JsonObject> {
  const wrapped = createHostToolFromOpenCodeTool("interactive_bash", interactive_bash, {
    directory: cwd,
    worktree: cwd,
  })

  return {
    ...wrapped,
    execute: async (request) => {
      const result = await wrapped.execute(request)
      return marksError(result) ? { ...result, isError: true } : result
    },
  }
}

export function registerGatedRuntimeTools(options: GatedRuntimeToolsOptions): GatedRuntimeToolsResult {
  const tools: TargetToolDefinition[] = []
  const unsupported: string[] = []
  const interactiveBashEnabled = options.interactiveBashEnabled ?? isInteractiveBashEnabled()

  if (interactiveBashEnabled) {
    const hostTool = createInteractiveBashHostTool(options.cwd)
    tools.push(
      registerTargetTool(options.registry, hostTool, {
        host: options.host,
        parameters: { kind: "opencode-args", args: interactive_bash.args },
        createSessionContext: () => createDetachedSessionContext(options.cwd),
      }),
    )
  }

  tools.push(registerTargetLookAtTool({
    host: options.host,
    registry: options.registry,
    cwd: options.cwd,
  }))

  return { tools, unsupported }
}
