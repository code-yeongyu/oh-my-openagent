import type { ToolDefinition } from "@opencode-ai/plugin"
import type { HostKind, HostSessionActions, HostSessionContext, HostToolDefinition, JsonObject } from "../host-contract"
import { resolveTargetAgentRoute, runTargetAgent, type TargetAgentRoute, type TargetAgentRunResult } from "../host-agents"
import { createTaskCreateTool, createTaskGetTool, createTaskList, createTaskUpdateTool } from "../tools/task"
import { createHostToolFromOpenCodeTool, registerTargetTool, type TargetToolDefinition, type TargetToolRegistry } from "./tool-registration"
import { TargetBackgroundManager } from "./background-manager"

export const TARGET_TASK_TOOL_NAMES = [
  "task",
  "call_omo_agent",
  "task_create",
  "task_get",
  "task_list",
  "task_update",
] as const

export type TargetTaskToolsOptions = {
  host: Exclude<HostKind, "opencode">
  registry: TargetToolRegistry
  cwd: string
  taskSystemEnabled?: boolean
  runAgent?: (route: TargetAgentRoute, options: { cwd: string; signal?: AbortSignal }) => Promise<TargetAgentRunResult>
  backgroundManager?: TargetBackgroundManager
  onBackgroundComplete?: (taskID: string) => void | Promise<void>
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

function stringInput(input: JsonObject, key: string): string | undefined {
  const value = input[key]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function createDelegationTool(
  name: "task" | "call_omo_agent",
  options: TargetTaskToolsOptions,
): HostToolDefinition<JsonObject> {
  return {
    name,
    label: name,
    description: `${name} delegates work to a named OMO agent or category.`,
    parameters: {
      type: "object",
      properties: {
        description: { type: "string" },
        prompt: { type: "string" },
        subagent_type: { type: "string" },
        category: { type: "string" },
        run_in_background: { type: "boolean" },
      },
      additionalProperties: true,
    },
    execute: async (request) => {
      const prompt = stringInput(request.input, "prompt")
      if (!prompt) throw new Error(`${name} requires prompt.`)
      const route = resolveTargetAgentRoute(options.host, {
        prompt,
        subagentType: stringInput(request.input, "subagent_type"),
        category: stringInput(request.input, "category"),
      })
      if (request.input.run_in_background === true && options.backgroundManager) {
        const task = options.backgroundManager.start(
          async (signal) => {
            const result = await (options.runAgent ?? runTargetAgent)(route, { cwd: options.cwd, signal })
            return result.text || result.stderr || `${route.agent.name} produced no output.`
          },
          async (completed) => options.onBackgroundComplete?.(completed.id),
        )
        return { content: [{ type: "text", text: JSON.stringify(task, null, 2) }], details: { taskID: task.id } }
      }
      const result = await (options.runAgent ?? runTargetAgent)(route, {
        cwd: options.cwd,
        signal: request.signal,
      })
      return {
        content: [{ type: "text", text: result.text || result.stderr || `${route.agent.name} produced no output.` }],
        isError: result.exitCode !== 0,
        details: {
          agent: route.agent.name,
          category: route.category,
          policy: route.agent.policy,
          exitCode: result.exitCode,
        },
      }
    },
  }
}

function registerNative(options: TargetTaskToolsOptions, tool: HostToolDefinition<JsonObject>): TargetToolDefinition {
  return registerTargetTool(options.registry, tool, {
    host: options.host,
    parameters: { kind: "json-schema", schema: tool.parameters as JsonObject },
    createSessionContext: () => createDetachedSessionContext(options.cwd),
  })
}

function registerOpenCodeBacked(
  options: TargetTaskToolsOptions,
  name: string,
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

export function registerTargetTaskTools(options: TargetTaskToolsOptions): readonly TargetToolDefinition[] {
  const registered = [
    registerNative(options, createDelegationTool("task", options)),
    registerNative(options, createDelegationTool("call_omo_agent", options)),
  ]
  if (options.taskSystemEnabled === false) return registered

  const config = {
    sisyphus: {
      tasks: {
        storage_path: `${options.cwd}/.omo/tasks`,
        task_list_id: options.host,
        claude_code_compat: false,
      },
    },
  }
  const definitions: Record<string, ToolDefinition> = {
    task_create: createTaskCreateTool(config),
    task_get: createTaskGetTool(config),
    task_list: createTaskList(config),
    task_update: createTaskUpdateTool(config),
  }
  for (const [name, definition] of Object.entries(definitions)) {
    registered.push(registerOpenCodeBacked(options, name, definition))
  }
  return registered
}
