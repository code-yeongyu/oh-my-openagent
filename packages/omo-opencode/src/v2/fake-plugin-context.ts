import type {
  V2AgentInfo,
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
}

export type FakePluginContext = {
  readonly context: V2PluginContext
  readonly addedTools: V2ToolInfo[]
  readonly registration: V2Registration
}

/** A 2.x plugin context for unit tests. Not part of the shipped bundle: only tests import it. */
export function createFakePluginContext(options: FakeContextOptions = {}): FakePluginContext {
  const addedTools: V2ToolInfo[] = []
  const registration: V2Registration = { dispose: async () => {} }
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
    agent: { list: async () => ({ data: options.agents ?? [] }) },
  }
  return { context, addedTools, registration }
}
