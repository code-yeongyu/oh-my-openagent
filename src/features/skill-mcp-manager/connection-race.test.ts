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
    disconnectedSessions: new Set(),
    authProviders: new Map(),
    cleanupRegistered: false,
    cleanupInterval: null,
    cleanupHandlers: [],
    idleTimeoutMs: 5 * 60 * 1000,
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
    expect(state.disconnectedSessions.has(info.sessionID)).toBe(true)
    expect(createdClients).toHaveLength(1)
    expect(createdClients[0]?.close).toHaveBeenCalledTimes(1)
    expect(createdTransports[0]?.close).toHaveBeenCalledTimes(1)
  })

  it("#given session A in disconnectedSessions #when new connection is requested for session A #then session A is removed from disconnectedSessions and connection proceeds normally", async () => {
    const state = createState()
    const info = createClientInfo("session-a")
    const clientKey = createClientKey(info)
    state.disconnectedSessions.add(info.sessionID)

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
