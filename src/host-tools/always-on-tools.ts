import type { PluginInput, ToolDefinition } from "@opencode-ai/plugin"
import type { HostKind, HostSessionActions, HostSessionContext, HostToolDefinition, JsonObject } from "../host-contract"
import { BACKGROUND_CANCEL_DESCRIPTION, BACKGROUND_OUTPUT_DESCRIPTION } from "../tools/background-task/constants"
import { createGlobTools } from "../tools/glob"
import { createGrepTools } from "../tools/grep"
import { createSessionManagerTools } from "../tools/session-manager"
import { createSkillTool } from "../tools/skill"
import { createHostToolFromOpenCodeTool, registerTargetTool, type TargetToolDefinition, type TargetToolRegistry } from "./tool-registration"
import { TargetBackgroundManager } from "./background-manager"

export const ALWAYS_ON_UTILITY_TOOL_NAMES = [
  "grep",
  "glob",
  "session_list",
  "session_read",
  "session_search",
  "session_info",
  "background_output",
  "background_cancel",
  "skill",
] as const

export type AlwaysOnUtilityToolName = (typeof ALWAYS_ON_UTILITY_TOOL_NAMES)[number]

export type AlwaysOnUtilityToolsOptions = {
  host: Exclude<HostKind, "opencode">
  registry: TargetToolRegistry
  cwd: string
  backgroundManager?: TargetBackgroundManager
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

function createTargetPluginInput(cwd: string): PluginInput {
  return {
    client: {} as PluginInput["client"],
    project: {} as PluginInput["project"],
    directory: cwd,
    worktree: cwd,
    experimental_workspace: {
      register: () => {},
    },
    serverUrl: new URL("http://localhost"),
    $: {} as PluginInput["$"],
  }
}

function createBackgroundTool(
  name: "background_output" | "background_cancel",
  description: string,
  manager: TargetBackgroundManager,
): HostToolDefinition<JsonObject> {
  return {
    name,
    label: name,
    description,
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: true,
    },
    execute: async ({ input }) => {
      const taskID = typeof input.task_id === "string" ? input.task_id : typeof input.taskId === "string" ? input.taskId : ""
      if (name === "background_cancel") {
        const cancelled = manager.cancel(taskID)
        return { content: [{ type: "text", text: cancelled ? `Cancelled ${taskID}.` : `Background task ${taskID} is not running.` }], isError: !cancelled }
      }
      const task = manager.get(taskID)
      return {
        content: [{ type: "text", text: task ? JSON.stringify(task, null, 2) : `Background task ${taskID} was not found.` }],
        isError: !task,
      }
    },
  }
}

function createAlwaysOnOpenCodeTools(cwd: string): Record<string, ToolDefinition> {
  const ctx = createTargetPluginInput(cwd)
  return {
    ...createGrepTools(ctx),
    ...createGlobTools(ctx),
    ...createSessionManagerTools(ctx, {
      setStorageClient: () => {},
    }),
    skill: createSkillTool({
      directory: cwd,
      commands: [],
      skills: [],
      includeSkillsInDescription: true,
    }),
  }
}

function registerOpenCodeBackedTool(
  options: AlwaysOnUtilityToolsOptions,
  name: AlwaysOnUtilityToolName,
  definition: ToolDefinition,
): TargetToolDefinition {
  const hostTool = createHostToolFromOpenCodeTool(name, definition, {
    directory: options.cwd,
    worktree: options.cwd,
  })

  return registerTargetTool(options.registry, hostTool, {
    host: options.host,
    parameters: { kind: "opencode-args", args: definition.args },
    createSessionContext: () => createDetachedSessionContext(options.cwd),
  })
}

function registerNativeHostTool(
  options: AlwaysOnUtilityToolsOptions,
  hostTool: HostToolDefinition<JsonObject>,
): TargetToolDefinition {
  return registerTargetTool(options.registry, hostTool, {
    host: options.host,
    parameters: { kind: "json-schema", schema: hostTool.parameters as JsonObject },
    createSessionContext: () => createDetachedSessionContext(options.cwd),
  })
}

export function registerAlwaysOnUtilityTools(options: AlwaysOnUtilityToolsOptions): readonly TargetToolDefinition[] {
  const registered: TargetToolDefinition[] = []
  const backgroundManager = options.backgroundManager ?? new TargetBackgroundManager()
  const openCodeTools = createAlwaysOnOpenCodeTools(options.cwd)

  for (const name of ALWAYS_ON_UTILITY_TOOL_NAMES) {
    if (name === "background_output") {
      registered.push(registerNativeHostTool(options, createBackgroundTool(name, BACKGROUND_OUTPUT_DESCRIPTION, backgroundManager)))
      continue
    }

    if (name === "background_cancel") {
      registered.push(registerNativeHostTool(options, createBackgroundTool(name, BACKGROUND_CANCEL_DESCRIPTION, backgroundManager)))
      continue
    }

    const definition = openCodeTools[name]
    if (definition) {
      registered.push(registerOpenCodeBackedTool(options, name, definition))
    }
  }

  return registered
}
