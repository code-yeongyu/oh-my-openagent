import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import type { ClaudeCodeMcpServer } from "../claude-code-mcp-loader/types"
import type { SkillMcpClientInfo, SkillMcpManagerState } from "./types"

type Deferred<TValue> = {
  promise: Promise<TValue>
  resolve: (value: TValue) => void
  reject: (error: Error) => void
}

const pendingConnects: Deferred<void>[] = []
const trackedStates: SkillMcpManagerState[] = []
const createdClients: MockClient[] = []
const createdTransports: MockStdioClientTransport[] = []

class MockClient {
  readonly close = mock(async () => {})

  constructor(
    _clientInfo: { name: string; version: string },
    _options: { capabilities: Record<string, never> }
  ) {
    createdClients.push(this)
  }

  async connect(_transport: MockStdioClientTransport): Promise<void> {
    const pendingConnect = pendingConnects.shift()
    if (pendingConnect) {
      await pendingConnect.promise
    }
  }
}

class MockStdioClientTransport {
  readonly close = mock(async () => {})

  constructor(_options: { command: string; args?: string[]; env?: Record<string, string>; stderr?: string }) {
    createdTransports.push(this)
  }
}

mock.module("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: MockClient,
}))

mock.module("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: MockStdioClientTransport,
}))

const { disconnectAll, disconnectSession } = await import("./cleanup")
const { getOrCreateClient } = await import("./connection")

function createDeferred<TValue>(): Deferred<TValue> {
  let resolvePromise: ((value: TValue) => void) | null = null
  let rejectPromise: ((error: Error) => void) | null = null
  const promise = new Promise<TValue>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })

  if (!resolvePromise || !rejectPromise) {
    throw new Error("Failed to create deferred promise")
  }

  return {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise,
  }
}

function createState(): SkillMcpManagerState {
  const state: SkillMcpManagerState = {
    clients: new Map(),
    pendingConnections: new Map(),
    disconnectedSessions: new Map(),
    authProviders: new Map(),
    cleanupRegistered: false,
    cleanupInterval: null,
    cleanupHandlers: [],
    idleTimeoutMs: 5 * 60 * 1000,
    shutdownGeneration: 0,
    inFlightConnections: new Map(),
    disposed: false,
  }

  trackedStates.push(state)
  return state
}

function createClientInfo(sessionID: string): SkillMcpClientInfo {
  return {
    serverName: "race-server",
    skillName: "race-skill",
    sessionID,
  }
}

function createClientKey(info: SkillMcpClientInfo): string {
  return `${info.sessionID}:${info.skillName}:${info.serverName}`
}

const stdioConfig: ClaudeCodeMcpServer = {
  command: "mock-mcp-server",
}

beforeEach(() => {
  pendingConnects.length = 0
  createdClients.length = 0
  createdTransports.length = 0
})

afterEach(async () => {
  for (const state of trackedStates) {
    await disconnectAll(state)
  }

  trackedStates.length = 0
  pendingConnects.length = 0
  createdClients.length = 0
  createdTransports.length = 0
})

describe("getOrCreateClient disconnect race", () => {
  it("#given pending connection for session A #when disconnectSession(A) is called before connection completes #then completed client is not added to state.clients", async () => {
    const state = createState()
    const info = createClientInfo("session-a")
    const clientKey = createClientKey(info)
    const pendingConnect = createDeferred<void>()
    pendingConnects.push(pendingConnect)

    const clientPromise = getOrCreateClient({ state, clientKey, info, config: stdioConfig })
    expect(state.pendingConnections.has(clientKey)).toBe(true)

    await disconnectSession(state, info.sessionID)
    pendingConnect.resolve(undefined)

    await expect(clientPromise).rejects.toThrow(/disconnected during MCP connection setup/)
    expect(state.clients.has(clientKey)).toBe(false)
    expect(state.pendingConnections.has(clientKey)).toBe(false)
    expect(state.disconnectedSessions.has(info.sessionID)).toBe(false)
    expect(createdClients).toHaveLength(1)
    expect(createdClients[0]?.close).toHaveBeenCalledTimes(1)
    expect(createdTransports[0]?.close).toHaveBeenCalledTimes(1)
  })

  it("#given session A in disconnectedSessions #when new connection completes with no remaining pending #then disconnectedSessions entry is cleaned up", async () => {
    const state = createState()
    const info = createClientInfo("session-a")
    const clientKey = createClientKey(info)
    state.disconnectedSessions.set(info.sessionID, 1)

    const client = await getOrCreateClient({ state, clientKey, info, config: stdioConfig })

    expect(state.disconnectedSessions.has(info.sessionID)).toBe(false)
    expect(state.clients.get(clientKey)?.client).toBe(client)
    expect(createdClients[0]?.close).not.toHaveBeenCalled()
  })

  it("#given no pending connections #when disconnectSession is called #then no errors occur and session is not added to disconnectedSessions", async () => {
    const state = createState()

    await expect(disconnectSession(state, "session-a")).resolves.toBeUndefined()
    expect(state.disconnectedSessions.has("session-a")).toBe(false)
    expect(state.pendingConnections.size).toBe(0)
    expect(state.clients.size).toBe(0)
  })
})

describe("getOrCreateClient disconnectAll race", () => {
  it("#given pending connection #when disconnectAll() is called before connection completes #then client is not added to state.clients", async () => {
    const state = createState()
    const info = createClientInfo("session-a")
    const clientKey = createClientKey(info)
    const pendingConnect = createDeferred<void>()
    pendingConnects.push(pendingConnect)

    const clientPromise = getOrCreateClient({ state, clientKey, info, config: stdioConfig })
    expect(state.pendingConnections.has(clientKey)).toBe(true)

    await disconnectAll(state)
    pendingConnect.resolve(undefined)

    await expect(clientPromise).rejects.toThrow(/connection completed after shutdown/)
    expect(state.clients.has(clientKey)).toBe(false)
  })

  it("#given state after disconnectAll() completed #when getOrCreateClient() is called #then it throws shut down error and registers nothing", async () => {
    const state = createState()
    const info = createClientInfo("session-b")
    const clientKey = createClientKey(info)

    await disconnectAll(state)

    await expect(getOrCreateClient({ state, clientKey, info, config: stdioConfig })).rejects.toThrow(/has been shut down/)
    expect(state.clients.size).toBe(0)
    expect(state.pendingConnections.size).toBe(0)
    expect(state.inFlightConnections.size).toBe(0)
    expect(state.disposed).toBe(true)
    expect(createdClients).toHaveLength(0)
    expect(createdTransports).toHaveLength(0)
  })
})

describe("getOrCreateClient multi-key disconnect race", () => {
  it("#given 2 pending connections for session A #when disconnectSession(A) before both complete #then both old connections are rejected", async () => {
    const state = createState()
    const infoKey1 = createClientInfo("session-a")
    const infoKey2 = { ...createClientInfo("session-a"), serverName: "server-2" }
    const clientKey1 = createClientKey(infoKey1)
    const clientKey2 = `${infoKey2.sessionID}:${infoKey2.skillName}:${infoKey2.serverName}`
    const pendingConnect1 = createDeferred<void>()
    const pendingConnect2 = createDeferred<void>()
    pendingConnects.push(pendingConnect1)
    pendingConnects.push(pendingConnect2)

    const promise1 = getOrCreateClient({ state, clientKey: clientKey1, info: infoKey1, config: stdioConfig })
    const promise2 = getOrCreateClient({ state, clientKey: clientKey2, info: infoKey2, config: stdioConfig })
    expect(state.pendingConnections.size).toBe(2)

    await disconnectSession(state, "session-a")

    pendingConnect1.resolve(undefined)
    await expect(promise1).rejects.toThrow(/disconnected during MCP connection setup/)

    pendingConnect2.resolve(undefined)
    await expect(promise2).rejects.toThrow(/disconnected during MCP connection setup/)

    expect(state.clients.has(clientKey1)).toBe(false)
    expect(state.clients.has(clientKey2)).toBe(false)
    expect(state.disconnectedSessions.has("session-a")).toBe(false)
  })

  it("#given a superseded pending connection #when the old connection completes #then the stale client is removed from state.clients", async () => {
    const state = createState()
    const info = createClientInfo("session-a")
    const clientKey = createClientKey(info)
    const pendingConnect = createDeferred<void>()
    const supersedingConnection = createDeferred<Awaited<ReturnType<typeof getOrCreateClient>>>()
    pendingConnects.push(pendingConnect)

    const clientPromise = getOrCreateClient({ state, clientKey, info, config: stdioConfig })
    state.pendingConnections.set(clientKey, supersedingConnection.promise)

    pendingConnect.resolve(undefined)

    await expect(clientPromise).rejects.toThrow(/superseded by a newer connection attempt/)
    expect(state.clients.has(clientKey)).toBe(false)
    expect(createdClients[0]?.close).toHaveBeenCalledTimes(1)
  })

  it("#given a superseded pending connection #when a newer client already replaced the map entry #then the stale cleanup does not delete the newer client", async () => {
    const state = createState()
    const info = createClientInfo("session-a")
    const clientKey = createClientKey(info)
    const pendingConnect = createDeferred<void>()
    const supersedingConnection = createDeferred<Awaited<ReturnType<typeof getOrCreateClient>>>()
    pendingConnects.push(pendingConnect)

    const newerClient = new MockClient(
      { name: "newer-client", version: "1.0.0" },
      { capabilities: {} },
    )
    const newerTransport = new MockStdioClientTransport({ command: "mock-mcp-server" })
    let replacedEntry = false
    const originalSet = state.clients.set.bind(state.clients)
    Reflect.set(state.clients, "set", (key: string, value: SkillMcpManagerState["clients"] extends Map<string, infer TValue> ? TValue : never) => {
      originalSet(key, value)
      if (!replacedEntry && key === clientKey) {
        replacedEntry = true
        originalSet(key, {
          client: newerClient as never,
          transport: newerTransport as never,
          skillName: info.skillName,
          lastUsedAt: Date.now(),
          connectionType: "stdio",
        })
      }
      return state.clients
    })

    const clientPromise = getOrCreateClient({ state, clientKey, info, config: stdioConfig })
    state.pendingConnections.set(clientKey, supersedingConnection.promise)

    pendingConnect.resolve(undefined)

    await expect(clientPromise).rejects.toThrow(/superseded by a newer connection attempt/)
    expect(state.clients.get(clientKey)?.client.close).toBe(newerClient.close)
    expect(newerClient.close).not.toHaveBeenCalled()
  })
})
