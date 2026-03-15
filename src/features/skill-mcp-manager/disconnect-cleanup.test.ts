import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { afterEach, describe, expect, it } from "bun:test"
import { disconnectSession, registerProcessCleanup, unregisterProcessCleanup } from "./cleanup"
import type { ManagedClient, SkillMcpManagerState } from "./types"

const trackedStates: SkillMcpManagerState[] = []

afterEach(() => {
  for (const state of trackedStates) {
    unregisterProcessCleanup(state)
  }

  trackedStates.length = 0
})

const expectedCleanupHandlerCount = process.platform === "win32" ? 3 : 2

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

function createManagedClient(skillName: string): ManagedClient {
  return {
    client: new Client(
      { name: `test-${skillName}`, version: "1.0.0" },
      { capabilities: {} }
    ),
    transport: new StreamableHTTPClientTransport(new URL("https://example.com/mcp")),
    skillName,
    lastUsedAt: Date.now(),
    connectionType: "http",
  }
}

describe("disconnectSession cleanup registration", () => {
  it("#given state with 1 client and cleanup registered #when disconnectSession removes last client #then process cleanup handlers are unregistered", async () => {
    // given
    const state = createState()
    const signalIntCountBeforeRegister = process.listenerCount("SIGINT")
    const signalTermCountBeforeRegister = process.listenerCount("SIGTERM")

    state.clients.set("session-1:skill-1:server-1", createManagedClient("skill-1"))
    registerProcessCleanup(state)

    // when
    await disconnectSession(state, "session-1")

    // then
    expect(state.cleanupRegistered).toBe(false)
    expect(state.cleanupHandlers).toEqual([])
    expect(process.listenerCount("SIGINT")).toBe(signalIntCountBeforeRegister)
    expect(process.listenerCount("SIGTERM")).toBe(signalTermCountBeforeRegister)
  })

  it("#given state with 2 clients in different sessions #when disconnectSession removes one session #then process cleanup handlers remain registered", async () => {
    // given
    const state = createState()
    const signalIntCountBeforeRegister = process.listenerCount("SIGINT")
    const signalTermCountBeforeRegister = process.listenerCount("SIGTERM")

    state.clients.set("session-1:skill-1:server-1", createManagedClient("skill-1"))
    state.clients.set("session-2:skill-2:server-2", createManagedClient("skill-2"))
    registerProcessCleanup(state)

    // when
    await disconnectSession(state, "session-1")

    // then
    expect(state.clients.has("session-2:skill-2:server-2")).toBe(true)
    expect(state.cleanupRegistered).toBe(true)
    expect(state.cleanupHandlers).toHaveLength(expectedCleanupHandlerCount)
    expect(process.listenerCount("SIGINT")).toBe(signalIntCountBeforeRegister + 1)
    expect(process.listenerCount("SIGTERM")).toBe(signalTermCountBeforeRegister + 1)
  })

  it("#given state with 2 clients in different sessions #when both sessions disconnected #then process cleanup handlers are unregistered", async () => {
    // given
    const state = createState()
    const signalIntCountBeforeRegister = process.listenerCount("SIGINT")
    const signalTermCountBeforeRegister = process.listenerCount("SIGTERM")

    state.clients.set("session-1:skill-1:server-1", createManagedClient("skill-1"))
    state.clients.set("session-2:skill-2:server-2", createManagedClient("skill-2"))
    registerProcessCleanup(state)

    // when
    await disconnectSession(state, "session-1")
    await disconnectSession(state, "session-2")

    // then
    expect(state.clients.size).toBe(0)
    expect(state.cleanupRegistered).toBe(false)
    expect(state.cleanupHandlers).toEqual([])
    expect(process.listenerCount("SIGINT")).toBe(signalIntCountBeforeRegister)
    expect(process.listenerCount("SIGTERM")).toBe(signalTermCountBeforeRegister)
  })

  it("#given state with 1 client and pending connection for different session and cleanup registered #when disconnectSession removes last client but pendingConnections remain #then process cleanup handlers stay registered", async () => {
    const state = createState()
    const signalIntCountBeforeRegister = process.listenerCount("SIGINT")
    const signalTermCountBeforeRegister = process.listenerCount("SIGTERM")
    const pendingClient = createManagedClient("skill-pending").client

    state.clients.set("session-1:skill-1:server-1", createManagedClient("skill-1"))
    state.pendingConnections.set("session-2:skill-2:server-2", Promise.resolve(pendingClient))
    registerProcessCleanup(state)

    await disconnectSession(state, "session-1")

    expect(state.clients.size).toBe(0)
    expect(state.pendingConnections.size).toBe(1)
    expect(state.cleanupRegistered).toBe(true)
    expect(state.cleanupHandlers).toHaveLength(expectedCleanupHandlerCount)
    expect(process.listenerCount("SIGINT")).toBe(signalIntCountBeforeRegister + 1)
    expect(process.listenerCount("SIGTERM")).toBe(signalTermCountBeforeRegister + 1)
  })
})
