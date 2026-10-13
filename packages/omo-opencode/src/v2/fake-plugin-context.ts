import type {
  V2AgentEditor,
  V2AgentInfo,
  V2AgentRecord,
  V2CommandDefinition,
  V2PromptInput,
  V2Event,
  V2ModelRef,
  V2McpEditor,
  V2McpServerConfig,
  V2ModelInfo,
  V2PluginContext,
  V2ProviderInfo,
  V2Registration,
  V2ToolInfo,
} from "./context-types"

export type FakeContextOptions = {
  readonly models?: ReadonlyArray<V2ModelInfo>
  readonly providers?: ReadonlyArray<V2ProviderInfo>
  readonly agents?: ReadonlyArray<V2AgentInfo>
  readonly defaultModel?: V2ModelInfo | null
  readonly directory?: string
  /** The agent the fake session is currently on. */
  readonly sessionAgent?: string
}

export type FakeSessionCall =
  | { readonly kind: "prompt"; readonly input: V2PromptInput }
  | { readonly kind: "switchAgent"; readonly sessionID: string; readonly agent: string }
  | { readonly kind: "switchModel"; readonly sessionID: string; readonly model: V2ModelRef }

export type FakePluginContext = {
  readonly context: V2PluginContext
  readonly addedTools: V2ToolInfo[]
  readonly registration: V2Registration
  /** The agents after the last time every registered agent transform ran against the host's base agents. */
  readonly builtAgents: () => ReadonlyMap<string, V2AgentRecord>
  readonly defaultAgent: () => string | undefined
  /** The MCP servers after the last time every registered MCP transform ran. */
  readonly builtMcp: () => ReadonlyMap<string, V2McpServerConfig>
  readonly mcpReloadCount: () => number
  readonly builtCommands: () => ReadonlyMap<string, V2CommandDefinition>
  readonly commandReloadCount: () => number
  /** Everything the plugin asked the session API to do, in order. */
  readonly sessionCalls: ReadonlyArray<FakeSessionCall>
  readonly reloadCount: () => number
  /** Delivers an event to every active `event.subscribe()` loop. */
  readonly emit: (event: V2Event) => void
  readonly activeSubscribers: () => number
}

function toRecord(agent: V2AgentInfo): V2AgentRecord {
  return {
    id: agent.id,
    name: agent.name,
    ...(agent.model === undefined ? {} : { model: { ...agent.model } }),
    request: { settings: {}, headers: {}, body: {} },
    ...(agent.description === undefined ? {} : { description: agent.description }),
    mode: agent.mode,
    hidden: agent.hidden,
    ...(agent.color === undefined ? {} : { color: agent.color }),
    ...(agent.steps === undefined ? {} : { steps: agent.steps }),
    permissions: agent.permissions.map((rule) => ({ ...rule })),
  }
}

function defaultRecord(id: string): V2AgentRecord {
  return {
    id,
    name: id,
    request: { settings: {}, headers: {}, body: {} },
    mode: "primary",
    hidden: false,
    permissions: [{ action: "*", resource: "*", effect: "allow" }],
  }
}

/** A 2.x plugin context for unit tests. Not part of the shipped bundle: only tests import it. */
export function createFakePluginContext(options: FakeContextOptions = {}): FakePluginContext {
  const addedTools: V2ToolInfo[] = []
  const registration: V2Registration = { dispose: async () => {} }
  const agentTransforms: Array<(editor: V2AgentEditor) => void> = []
  let built = new Map<string, V2AgentRecord>()
  let chosenDefault: string | undefined
  let reloads = 0
  const mcpTransforms: Array<(editor: V2McpEditor) => void> = []
  let mcpBuilt = new Map<string, V2McpServerConfig>()
  let mcpReloads = 0
  const commandTransforms: Array<(editor: { readonly add: (definition: V2CommandDefinition) => void }) => void> = []
  let commandsBuilt = new Map<string, V2CommandDefinition>()
  let commandReloads = 0
  const sessionCalls: FakeSessionCall[] = []
  const subscribers = new Set<(event: V2Event) => void>()

  const rebuildAgents = (): void => {
    built = new Map((options.agents ?? []).map((agent) => [agent.id, toRecord(agent)]))
    chosenDefault = undefined
    const editor: V2AgentEditor = {
      list: () => [...built.values()],
      get: (id) => built.get(id),
      default: (id) => {
        chosenDefault = id
      },
      update: (id, update) => {
        const current = built.get(id) ?? defaultRecord(id)
        built.set(id, current)
        update(current)
      },
      remove: (id) => void built.delete(id),
    }
    for (const transform of agentTransforms) transform(editor)
  }

  const rebuildMcp = (): void => {
    mcpBuilt = new Map()
    const editor: V2McpEditor = {
      list: () => [...mcpBuilt],
      get: (name) => mcpBuilt.get(name),
      set: (name, config) => void mcpBuilt.set(name, config),
      remove: (name) => void mcpBuilt.delete(name),
    }
    for (const transform of mcpTransforms) transform(editor)
  }

  const rebuildCommands = (): void => {
    commandsBuilt = new Map()
    for (const transform of commandTransforms) transform({ add: (definition) => void commandsBuilt.set(definition.name, definition) })
  }

  const subscribe = (subscribeOptions?: { readonly signal?: AbortSignal }): AsyncIterable<V2Event> => ({
    [Symbol.asyncIterator]() {
      const queue: V2Event[] = []
      let wake: (() => void) | undefined
      let closed = false
      const push = (event: V2Event): void => {
        queue.push(event)
        wake?.()
      }
      subscribers.add(push)
      const close = (): void => {
        closed = true
        subscribers.delete(push)
        wake?.()
      }
      subscribeOptions?.signal?.addEventListener("abort", close, { once: true })
      if (subscribeOptions?.signal?.aborted) close()
      return {
        async next() {
          while (queue.length === 0 && !closed) await new Promise<void>((resolve) => (wake = resolve))
          const event = queue.shift()
          return event === undefined ? { done: true, value: undefined } : { done: false, value: event }
        },
        async return() {
          close()
          return { done: true, value: undefined }
        },
      }
    },
  })

  const context: V2PluginContext = {
    app: { name: "cli", version: "2.0.28", channel: "latest" },
    location: {
      directory: options.directory ?? "/work/app",
      project: { id: "proj_1", directory: "/work/app", canonical: "/work/app" },
    },
    options: {},
    tool: {
      transform: async (callback) => {
        callback({ add: (info) => void addedTools.push(info) })
        return registration
      },
    },
    model: {
      list: async () => ({ data: options.models ?? [] }),
      default: async () => ({ data: options.defaultModel ?? null }),
    },
    provider: { list: async () => ({ data: options.providers ?? [] }) },
    agent: {
      list: async () => ({ data: options.agents ?? [] }),
      transform: async (callback) => {
        agentTransforms.push(callback)
        rebuildAgents()
        return {
          dispose: async () => {
            agentTransforms.splice(agentTransforms.indexOf(callback), 1)
            rebuildAgents()
          },
        }
      },
      reload: async () => {
        reloads += 1
        rebuildAgents()
      },
    },
    mcp: {
      transform: async (callback) => {
        mcpTransforms.push(callback)
        rebuildMcp()
        return {
          dispose: async () => {
            mcpTransforms.splice(mcpTransforms.indexOf(callback), 1)
            rebuildMcp()
          },
        }
      },
      reload: async () => {
        mcpReloads += 1
        rebuildMcp()
      },
    },
    command: {
      transform: async (callback) => {
        commandTransforms.push(callback)
        rebuildCommands()
        return {
          dispose: async () => {
            commandTransforms.splice(commandTransforms.indexOf(callback), 1)
            rebuildCommands()
          },
        }
      },
      reload: async () => {
        commandReloads += 1
        rebuildCommands()
      },
    },
    session: {
      get: async () => ({ ...(options.sessionAgent === undefined ? {} : { agent: options.sessionAgent }) }),
      prompt: async (input) => void sessionCalls.push({ kind: "prompt", input }),
      switchAgent: async (input) => void sessionCalls.push({ kind: "switchAgent", ...input }),
      switchModel: async (input) => void sessionCalls.push({ kind: "switchModel", ...input }),
    },
    event: { subscribe },
  }

  return {
    context,
    addedTools,
    registration,
    builtAgents: () => built,
    defaultAgent: () => chosenDefault,
    builtMcp: () => mcpBuilt,
    mcpReloadCount: () => mcpReloads,
    builtCommands: () => commandsBuilt,
    commandReloadCount: () => commandReloads,
    sessionCalls,
    reloadCount: () => reloads,
    emit: (event) => {
      for (const push of subscribers) push(event)
    },
    activeSubscribers: () => subscribers.size,
  }
}
