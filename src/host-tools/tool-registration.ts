import type { ToolContext, ToolDefinition as OpenCodeToolDefinition } from "@opencode-ai/plugin/tool"
import type { HostKind, HostSessionContext, HostToolDefinition, HostToolResult, JsonObject } from "../host-contract"
import { normalizeTargetToolParameters, type ToolParameterInput } from "./tool-schema"
import {
  createHostToolErrorResult,
  normalizeOpenCodeToolResult,
  toTargetToolResult,
  type TargetToolResult,
} from "./tool-result"

export type TargetToolExecute = (
  toolCallId: string,
  params: Record<string, unknown>,
  signal?: AbortSignal,
) => Promise<TargetToolResult>

export type TargetToolDefinition = {
  name: string
  label: string
  description: string
  parameters: unknown
  hidden?: boolean
  defaultInactive?: boolean
  mcpServerName?: string
  mcpToolName?: string
  execute: TargetToolExecute
}

export type TargetToolRegistry = {
  registerTool(tool: TargetToolDefinition): void
}

export type TargetToolRegistrationOptions = {
  host: Exclude<HostKind, "opencode">
  parameters: ToolParameterInput
  createSessionContext(): HostSessionContext
}

export type OpenCodeToolAdapterOptions = {
  directory: string
  worktree?: string
  agent?: string
}

function toJsonObject(value: Record<string, unknown>): JsonObject {
  return value as JsonObject
}

function errorMessage(result: HostToolResult): string {
  const text = result.content
    .filter((item): item is Extract<(typeof result.content)[number], { type: "text" }> => item.type === "text")
    .map((item) => item.text)
    .join("\n")
    .trim()
  return text || "Tool execution failed."
}

function createTargetExecute(
  tool: HostToolDefinition<JsonObject>,
  createSessionContext: () => HostSessionContext,
): TargetToolExecute {
  return async (toolCallId, params, signal) => {
    let result: HostToolResult
    try {
      result = await tool.execute({
        toolCallId,
        name: tool.name,
        input: toJsonObject(params),
        signal,
        session: createSessionContext(),
      })
    } catch (error) {
      result = createHostToolErrorResult(error)
    }

    if (result.isError === true) {
      throw new Error(errorMessage(result))
    }
    return toTargetToolResult(result)
  }
}

export function createTargetToolDefinition(
  tool: HostToolDefinition<JsonObject>,
  options: TargetToolRegistrationOptions,
): TargetToolDefinition {
  const targetParameters = normalizeTargetToolParameters(options.host, options.parameters)

  return {
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters: targetParameters.parameters,
    hidden: tool.hidden,
    defaultInactive: tool.defaultInactive,
    mcpServerName: tool.mcpServerName,
    mcpToolName: tool.mcpToolName,
    execute: createTargetExecute(tool, options.createSessionContext),
  }
}

export function registerTargetTool(
  registry: TargetToolRegistry,
  tool: HostToolDefinition<JsonObject>,
  options: TargetToolRegistrationOptions,
): TargetToolDefinition {
  const targetTool = createTargetToolDefinition(tool, options)
  registry.registerTool(targetTool)
  return targetTool
}

function createOpenCodeToolContext(
  session: HostSessionContext,
  signal: AbortSignal | undefined,
  options: OpenCodeToolAdapterOptions,
): ToolContext {
  return {
    sessionID: session.id,
    messageID: "target-message",
    agent: options.agent ?? "sisyphus",
    directory: options.directory,
    worktree: options.worktree ?? options.directory,
    abort: signal ?? new AbortController().signal,
    metadata: () => {},
    ask: async () => {},
  }
}

export function createHostToolFromOpenCodeTool(
  name: string,
  definition: OpenCodeToolDefinition,
  options: OpenCodeToolAdapterOptions,
): HostToolDefinition<JsonObject> {
  type ExecuteArgs = Parameters<OpenCodeToolDefinition["execute"]>[0]

  return {
    name,
    label: name,
    description: definition.description,
    parameters: definition.args,
    execute: async (request) => {
      const context = createOpenCodeToolContext(request.session, request.signal, options)
      const result = await definition.execute(request.input as ExecuteArgs, context)
      return normalizeOpenCodeToolResult(result)
    },
  }
}
