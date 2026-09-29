import { existsSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

import type { Plugin } from "@opencode/plugin"

import { log } from "../shared/logger"
import { agentMarkdownDirectory, nestedAgentID, writeAgentMarkdown } from "./agent-markdown"
import { toolInputSchema, toolResult } from "./tool-schema"

type V2Context = Plugin.Context

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export type V2McpServer =
  | {
    type: "remote"
    url: string
    headers?: Record<string, string>
    disabled?: boolean
    oauth?: false
  }
  | {
    type: "local"
    command: string[]
    cwd?: string
    environment?: Record<string, string>
    disabled?: boolean
  }

export function mcpServerFromV1(value: unknown): V2McpServer | undefined {
  if (!isRecord(value)) return undefined
  const disabled = value.enabled === false || value.disabled === true
  if (typeof value.url === "string" && (value.type === "remote" || value.type === undefined)) {
    const headers = isRecord(value.headers)
      ? Object.fromEntries(Object.entries(value.headers).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
      : undefined
    return {
      type: "remote",
      url: value.url,
      ...(headers && Object.keys(headers).length > 0 ? { headers } : {}),
      ...(disabled ? { disabled: true } : {}),
      ...(value.oauth === false ? { oauth: false } : {}),
    }
  }
  const command = Array.isArray(value.command)
    ? value.command.filter((part): part is string => typeof part === "string")
    : typeof value.command === "string"
      ? [value.command]
      : []
  if (command.length === 0) return undefined
  const environment = isRecord(value.environment)
    ? Object.fromEntries(Object.entries(value.environment).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
    : undefined
  return {
    type: "local",
    command,
    ...(typeof value.cwd === "string" ? { cwd: value.cwd } : {}),
    ...(environment && Object.keys(environment).length > 0 ? { environment } : {}),
    ...(disabled ? { disabled: true } : {}),
  }
}

function commandText(template: string, args: string, sessionID: string): string {
  return template
    .replaceAll("$ARGUMENTS", args)
    .replaceAll("$SESSION_ID", sessionID)
    .replaceAll("$TIMESTAMP", new Date().toISOString())
}

function skillRecords(skills: unknown): Array<{ id: string; name: string; path: string; content: string }> {
  if (!isRecord(skills) || !Array.isArray(skills.paths)) return []
  const records = []
  for (const entry of skills.paths) {
    if (typeof entry !== "string" || !existsSync(entry)) continue
    const file = statSync(entry).isDirectory() ? join(entry, "SKILL.md") : entry
    if (!existsSync(file)) continue
    const content = readFileSync(file, "utf8")
    const name = file.split(/[\\/]/).at(-1)?.replace(/\.md$/i, "") || "skill"
    records.push({ id: name, name, path: file, content })
  }
  return records
}

async function projectTools(input: {
  ctx: V2Context
  directory: string
  tools: unknown
  disabled: unknown
  defineTool: unknown
}): Promise<void> {
  const tools = isRecord(input.tools) ? input.tools : {}
  const definitions = new Map<string, { description: string; input: Record<string, unknown>; execute: (args: unknown, context: unknown) => Promise<unknown> }>()
  for (const [name, value] of Object.entries(tools)) {
    if (!isRecord(value) || typeof value.execute !== "function") continue
    const description = typeof value.description === "string" ? value.description : name
    const schema = toolInputSchema(value)
    const defined = { description, parameters: schema }
    if (typeof input.defineTool === "function") {
      await (input.defineTool as (toolInput: { toolID: string }, output: { description: string; parameters: unknown }) => Promise<void>)(
        { toolID: name },
        defined,
      )
    }
    definitions.set(name, {
      description: defined.description,
      input: isRecord(defined.parameters) ? defined.parameters : schema,
      execute: value.execute as (args: unknown, context: unknown) => Promise<unknown>,
    })
  }

  await input.ctx.tool.transform((editor) => {
    for (const [name, tool] of definitions) {
      try {
        editor.add({
          name,
          description: tool.description,
          input: tool.input,
          execute: async (args, context) => {
            const result = await tool.execute(args, {
              ...context,
              directory: input.directory,
              sessionID: context.sessionID,
              callID: context.id,
              abort: context.signal,
            })
            return toolResult(result)
          },
        })
      } catch (error) {
        log("[oh-my-openagent] tool registration failed", {
          tool: name,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    if (!isRecord(input.disabled)) return
    for (const [pattern, enabled] of Object.entries(input.disabled)) {
      if (enabled !== false) continue
      if (!pattern.includes("*")) {
        editor.remove(pattern)
        continue
      }
      const prefix = pattern.slice(0, pattern.indexOf("*"))
      for (const registered of editor.list()) {
        if (registered.id.startsWith(prefix) || registered.name.startsWith(prefix)) editor.remove(registered.id)
      }
    }
  })
}

function todoTool(
  name: string,
  description: string,
  todos: { read: (sessionID: string) => unknown; write: (sessionID: string, input: unknown) => void },
) {
  return {
    name,
    description,
    input: {
      type: "object",
      properties: {
        todos: { type: "array" },
      },
    },
    execute: async (args: unknown, context: { sessionID: string }) => {
      if (name === "todowrite") todos.write(context.sessionID, args)
      return toolResult(name === "todoread" ? { todos: todos.read(context.sessionID) } : "todos updated")
    },
  }
}

async function registerTodoTools(
  ctx: V2Context,
  todos: { read: (sessionID: string) => unknown; write: (sessionID: string, input: unknown) => void },
): Promise<void> {
  await ctx.tool.transform((editor) => {
    const names = new Set(editor.list().map((tool) => tool.name))
    for (const tool of [
      todoTool("todowrite", "Update the session todo list", todos),
      todoTool("todoread", "Read the session todo list", todos),
    ]) {
      if (names.has(tool.name)) continue
      editor.add(tool)
    }
  })
}

export async function projectV1Surface(input: {
  ctx: V2Context
  directory: string
  config: Record<string, unknown>
  tools: unknown
  defineTool?: unknown
  commandBefore?: (commandInput: { command: string; sessionID: string; arguments: string }, output: { parts: Array<{ type: string; text?: string }> }) => Promise<void> | void
  agentDirectory?: string
  recordTodos?: {
    read: (sessionID: string) => unknown
    write: (sessionID: string, input: unknown) => void
  }
}): Promise<void> {
  const agents = isRecord(input.config.agent) ? input.config.agent : {}
  const written = writeAgentMarkdown({
    directory: input.agentDirectory ?? agentMarkdownDirectory(),
    agents,
  })
  const agentIDs = new Map(written.map((agent) => [agent.name, agent.id]))
  const defaultAgent = typeof input.config.default_agent === "string" ? input.config.default_agent : undefined

  await input.ctx.agent.transform((editor) => {
    for (const [name, id] of agentIDs) {
      const config = agents[name]
      if (!isRecord(config)) continue
      const apply = (agent: { description?: string; mode?: string; system?: string }) => {
        if (typeof config.description === "string") agent.description = config.description
        if (config.mode === "primary" || config.mode === "subagent" || config.mode === "all") agent.mode = config.mode
        if (typeof config.prompt === "string") agent.system = config.prompt
      }
      if (editor.get(id)) editor.update(id, apply)
      if (editor.get(name)) editor.update(name, apply)
    }
    if (!defaultAgent) return
    const nested = nestedAgentID(defaultAgent)
    if (editor.get(nameOr(editor, defaultAgent, nested))) editor.default(nameOr(editor, defaultAgent, nested))
  })

  await projectTools({
    ctx: input.ctx,
    directory: input.directory,
    tools: input.tools,
    disabled: input.config.tools,
    defineTool: input.defineTool,
  })
  if (input.recordTodos) await registerTodoTools(input.ctx, input.recordTodos)

  const commands = isRecord(input.config.command) ? input.config.command : {}
  await input.ctx.command.transform((editor) => {
    for (const [name, value] of Object.entries(commands)) {
      if (!isRecord(value)) continue
      const template = typeof value.template === "string" ? value.template : typeof value.prompt === "string" ? value.prompt : undefined
      if (!template) continue
      try {
        editor.add({
          name,
          ...(typeof value.description === "string" ? { description: value.description } : {}),
          execute: async ({ sessionID, prompt, delivery }) => {
            const parts = [{ type: "text", text: commandText(template, prompt.text, sessionID) }]
            await input.commandBefore?.({ command: name, sessionID, arguments: prompt.text }, { parts })
            const text = parts
              .map((part) => (part.type === "text" && typeof part.text === "string" ? part.text : ""))
              .filter((part) => part.length > 0)
              .join("\n")
            if (typeof value.agent === "string") {
              await input.ctx.session.switchAgent({ sessionID, agent: value.agent })
            }
            if (typeof value.model === "string" && value.model.includes("/")) {
              const [providerID, ...rest] = value.model.split("/")
              const modelID = rest.join("/")
              if (providerID && modelID) {
                await input.ctx.session.switchModel({ sessionID, model: { providerID, id: modelID } })
              }
            }
            await input.ctx.session.prompt({ sessionID, text, delivery })
          },
        })
      } catch (error) {
        log("[oh-my-openagent] command registration failed", {
          command: name,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  })

  const mcp = isRecord(input.config.mcp) ? input.config.mcp : {}
  await input.ctx.mcp.transform((editor) => {
    for (const [name, value] of Object.entries(mcp)) {
      const server = mcpServerFromV1(value)
      if (!server) continue
      try {
        editor.set(name, server)
      } catch (error) {
        log("[oh-my-openagent] mcp registration failed", {
          server: name,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  })

  const skills = skillRecords(input.config.skills)
  if (skills.length > 0) {
    await input.ctx.skill.transform((editor) => {
      for (const skill of skills) {
        try {
          editor.add(skill as never)
        } catch (error) {
          log("[oh-my-openagent] skill registration failed", {
            skill: skill.id,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
    })
  }

  await projectProviders(input.ctx, isRecord(input.config.provider) ? input.config.provider : {})
}

function nameOr(editor: { get(id: string): unknown }, bare: string, nested: string): string {
  if (editor.get(nested)) return nested
  return bare
}

async function projectProviders(ctx: V2Context, providers: Record<string, unknown>): Promise<void> {
  if (Object.keys(providers).length === 0) return
  let providerApi: typeof import("@opencode/plugin").Provider
  let modelApi: typeof import("@opencode/plugin").Model
  try {
    const plugin = await import("@opencode/plugin")
    providerApi = plugin.Provider
    modelApi = plugin.Model
  } catch (error) {
    log("[oh-my-openagent] provider projection skipped", {
      error: error instanceof Error ? error.message : String(error),
    })
    return
  }

  await ctx.provider.transform((editor) => {
    for (const [providerID, value] of Object.entries(providers)) {
      if (!isRecord(value)) continue
      try {
        const id = providerApi.ID.make(providerID)
        const models = isRecord(value.models)
          ? Object.keys(value.models).map((modelID) => ({
            ...modelApi.Info.default(id, modelApi.ID.make(modelID)),
            name: modelID,
          }))
          : []
        editor.add({
          info: {
            ...providerApi.Info.empty(id),
            name: typeof value.name === "string" ? value.name : providerID,
            activation: "enabled",
            package: typeof value.npm === "string" ? value.npm : "@ai-sdk/openai-compatible",
            settings: isRecord(value.options) ? value.options : {},
          },
          models,
        })
      } catch (error) {
        log("[oh-my-openagent] provider registration failed", {
          provider: providerID,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  })

  await ctx.model.transform((editor) => {
    for (const [providerID, value] of Object.entries(providers)) {
      if (!isRecord(value) || !isRecord(value.models)) continue
      for (const [modelID, modelConfig] of Object.entries(value.models)) {
        if (!isRecord(modelConfig)) continue
        const context = isRecord(modelConfig.limit) && typeof modelConfig.limit.context === "number"
          ? modelConfig.limit.context
          : undefined
        if (context === undefined || !editor.get(providerID, modelID)) continue
        editor.update(providerID, modelID, (model) => {
          const record = model as { limit?: Record<string, unknown> }
          record.limit = { ...(isRecord(record.limit) ? record.limit : {}), context }
        })
      }
    }
  })
}
