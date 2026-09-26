import { $ } from "bun"
import type { PluginInput } from "@opencode-ai/plugin"
import type { Plugin } from "@opencode/plugin"
import { createEventBus } from "./event-bus"
import type { V2Event } from "./event-bus"
import { toV1MessageViews } from "./message-text"
import { createSessionRegistry, createStatusCache, createTodoStore } from "./stores"
import type { V2SessionRegistry, V2StatusCache, V2TodoStore } from "./stores"
import { log } from "../shared/logger"

export interface V2CompatDeps {
  registry: V2SessionRegistry
  todos: V2TodoStore
  statusCache: V2StatusCache
}

type V2Context = Plugin.Context

function ok<T>(data: T): { data: T; error: null } {
  return { data, error: null }
}

function fail(error: unknown): { data: null; error: { message: string } } {
  return { data: null, error: { message: error instanceof Error ? error.message : String(error) } }
}

function readPathId(args: unknown): string | undefined {
  if (typeof args !== "object" || args === null) return undefined
  const path = (args as { path?: unknown }).path
  if (typeof path !== "object" || path === null) return undefined
  const id = (path as { id?: unknown }).id
  return typeof id === "string" ? id : undefined
}

function readQueryDirectory(args: unknown): string | undefined {
  if (typeof args !== "object" || args === null) return undefined
  const query = (args as { query?: unknown }).query
  if (typeof query !== "object" || query === null) return undefined
  const directory = (query as { directory?: unknown }).directory
  return typeof directory === "string" ? directory : undefined
}

function promptTextFromParts(parts: unknown): { text: string; files: Array<{ uri: string; name?: string }> } {
  if (!Array.isArray(parts)) return { text: "", files: [] }
  const texts: string[] = []
  const files: Array<{ uri: string; name?: string }> = []
  for (const part of parts) {
    if (typeof part !== "object" || part === null) continue
    const typed = part as { type?: unknown; text?: unknown; url?: unknown; filename?: unknown }
    if (typed.type === "text" && typeof typed.text === "string") texts.push(typed.text)
    if (typed.type === "file" && typeof typed.url === "string") {
      files.push(
        typeof typed.filename === "string" ? { uri: typed.url, name: typed.filename } : { uri: typed.url },
      )
    }
  }
  return { text: texts.join("\n"), files }
}

export function createV1CompatContext(v2: V2Context, overrides: Partial<V2CompatDeps> = {}): PluginInput {
  const directory = v2.location.directory
  const registry = overrides.registry ?? createSessionRegistry(v2.storage)
  const todos = overrides.todos ?? createTodoStore(v2.storage)
  const statusCache = overrides.statusCache ?? createStatusCache()
  const bus = createEventBus(v2.event, statusCache)
  void bus

  const session = {
    get: async (args: unknown) => {
      const id = readPathId(args)
      if (!id) return fail(new Error("session id is required"))
      try {
        return ok(await v2.session.get({ sessionID: id }))
      } catch (error) {
        return fail(error)
      }
    },
    messages: async (args: unknown) => {
      const id = readPathId(args)
      if (!id) return fail(new Error("session id is required"))
      try {
        const messages = await v2.session.context({ sessionID: id })
        return ok(toV1MessageViews(messages, id))
      } catch (error) {
        return fail(error)
      }
    },
    status: async () => ok(statusCache.snapshot()),
    create: async (args: unknown) => {
      const body = (typeof args === "object" && args !== null ? (args as { body?: unknown }).body : {}) as {
        parentID?: unknown
        title?: unknown
      }
      const targetDirectory = readQueryDirectory(args) ?? directory
      try {
        const created = await v2.session.create({
          ...(typeof body.title === "string" ? { title: body.title } : {}),
          location: { directory: targetDirectory },
        })
        await registry.register({
          id: created.id,
          ...(typeof body.parentID === "string" ? { parentID: body.parentID } : {}),
          directory: targetDirectory,
          createdAt: Date.now(),
        })
        return ok({ id: created.id })
      } catch (error) {
        return fail(error)
      }
    },
    promptAsync: async (args: unknown) => {
      const id = readPathId(args)
      if (!id) return fail(new Error("session id is required"))
      const body = (typeof args === "object" && args !== null ? (args as { body?: unknown }).body : {}) as {
        parts?: unknown
        agent?: unknown
        model?: unknown
      }
      try {
        if (typeof body.agent === "string" && body.agent) {
          await v2.session.switchAgent({ sessionID: id, agent: body.agent }).catch(() => {})
        }
        const model = body.model as { providerID?: unknown; modelID?: unknown } | undefined
        if (model && typeof model.providerID === "string" && typeof model.modelID === "string") {
          await v2.session
            .switchModel({ sessionID: id, model: { id: model.modelID, providerID: model.providerID } })
            .catch(() => {})
        }
        const { text, files } = promptTextFromParts(body.parts)
        await v2.session.prompt({
          sessionID: id,
          text,
          ...(files.length > 0 ? { files } : {}),
          delivery: "queue",
        })
        return ok(undefined)
      } catch (error) {
        return fail(error)
      }
    },
    prompt: async (args: unknown) => {
      const id = readPathId(args)
      if (!id) return fail(new Error("session id is required"))
      const result = await (session.promptAsync as (args: unknown) => Promise<{ data: null; error: { message: string } } | { data: undefined; error: null }>)(args)
      if ("error" in result && result.error) return result
      try {
        await v2.session.wait({ sessionID: id })
      } catch (error) {
        return fail(error)
      }
      return ok(undefined)
    },
    abort: async (args: unknown) => {
      const id = readPathId(args)
      if (!id) return fail(new Error("session id is required"))
      try {
        await v2.session.interrupt({ sessionID: id })
        return ok(undefined)
      } catch (error) {
        return fail(error)
      }
    },
    delete: async (args: unknown) => {
      const id = readPathId(args)
      if (!id) return fail(new Error("session id is required"))
      await registry.remove(id)
      log("[omo-v2] session.delete has no V2 server equivalent; dropped from local registry", { sessionID: id })
      return ok(undefined)
    },
    todo: async (args: unknown) => {
      const id = readPathId(args)
      if (!id) return fail(new Error("session id is required"))
      return ok(await todos.get(id))
    },
    children: async (args: unknown) => {
      const id = readPathId(args)
      if (!id) return fail(new Error("session id is required"))
      return ok((await registry.childrenOf(id)).map((record) => ({ id: record.id })))
    },
    list: async () => {
      const records = await registry.list()
      const items: Array<Record<string, unknown>> = []
      for (const record of records) {
        try {
          const info = await v2.session.get({ sessionID: record.id })
          items.push({
            id: record.id,
            parentID: record.parentID,
            directory: record.directory,
            title: info.title,
            time: { created: info.time.created, updated: info.time.updated },
          })
        } catch {
          items.push({ id: record.id, parentID: record.parentID, directory: record.directory })
        }
      }
      return ok(items)
    },
    message: async (args: unknown) => {
      const id = readPathId(args)
      const messageID =
        typeof args === "object" && args !== null
          ? ((args as { path?: { messageID?: unknown } }).path?.messageID as unknown)
          : undefined
      if (!id || typeof messageID !== "string") return fail(new Error("session id and message id are required"))
      try {
        const views = toV1MessageViews(await v2.session.context({ sessionID: id }), id)
        const found = views.find((view) => view.info.id === messageID)
        if (!found) return fail(new Error(`message not found: ${messageID}`))
        return ok(found)
      } catch (error) {
        return fail(error)
      }
    },
    summarize: async (args: unknown) => {
      const id = readPathId(args)
      if (!id) return fail(new Error("session id is required"))
      try {
        const generated = await v2.session.generate({
          sessionID: id,
          prompt: "Summarize this conversation concisely: key decisions, open todos, and current state.",
        })
        return ok({ summary: generated.text })
      } catch (error) {
        return fail(error)
      }
    },
    update: async (args: unknown) => {
      const id = readPathId(args)
      if (!id) return fail(new Error("session id is required"))
      const body = (typeof args === "object" && args !== null ? (args as { body?: unknown }).body : {}) as {
        title?: unknown
      }
      try {
        if (typeof body.title === "string") await v2.session.update({ sessionID: id, title: body.title })
        return ok(undefined)
      } catch (error) {
        return fail(error)
      }
    },
  }

  const client = {
    session,
    tui: {
      showToast: async (args: unknown) => {
        const body = (typeof args === "object" && args !== null ? (args as { body?: unknown }).body : undefined)
        log("[omo-v2] toast degraded to log (no V2 headless toast)", { body })
      },
    },
    config: {
      get: async () => {
        let model: string | undefined
        try {
          const current = await v2.model.default()
          if (current.data) model = `${current.data.providerID}/${current.data.modelID}`
        } catch {
          model = undefined
        }
        return ok({ skills: { paths: [], urls: [] as string[] }, model, formatter: undefined })
      },
    },
    app: {
      agents: async () => {
        try {
          return ok((await v2.agent.list()).data)
        } catch (error) {
          return fail(error)
        }
      },
    },
    provider: {
      list: async () => {
        try {
          const [providers, models] = await Promise.all([v2.provider.list(), v2.model.list()])
          const byProvider = new Map<string, Record<string, { id: string }>>()
          for (const model of models.data) {
            let entry = byProvider.get(model.providerID)
            if (!entry) {
              entry = {}
              byProvider.set(model.providerID, entry)
            }
            entry[model.modelID] = { id: model.modelID }
          }
          const all = providers.data.map((provider) => ({
            id: provider.id,
            ...(byProvider.get(provider.id) ? { models: byProvider.get(provider.id) } : {}),
          }))
          const connected = providers.data
            .filter((provider) => provider.activation !== "disabled")
            .map((provider) => provider.id)
          return ok({ connected, all })
        } catch (error) {
          return fail(error)
        }
      },
    },
    model: {
      list: async () => {
        try {
          const models = await v2.model.list()
          return ok(
            models.data.map((model) => ({ ...model, provider: model.providerID, id: model.modelID })),
          )
        } catch (error) {
          return fail(error)
        }
      },
    },
    event: {
      subscribe: async (args: unknown) => {
        const wanted = readQueryDirectory(args)
        async function* stream(): AsyncGenerator<{ type: string; properties: unknown }> {
          for await (const item of v2.event.subscribe()) {
            const typed = item as { type?: unknown; data?: unknown; location?: { directory?: unknown } }
            if (typeof typed.type !== "string") continue
            if (wanted && typed.location?.directory !== wanted) continue
            yield { type: typed.type, properties: typed.data ?? {} }
          }
        }
        return { stream: stream() }
      },
    },
  }

  return {
    client: client as unknown as PluginInput["client"],
    project: { id: v2.location.project.id } as unknown as PluginInput["project"],
    directory,
    worktree: directory,
    experimental_workspace: { register: () => {} },
    serverUrl: undefined as unknown as URL,
    $: $ as unknown as PluginInput["$"],
  }
}

export type { V2Event }
