import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import type { ClaudeCodeMcpServer } from "../claude-code-mcp-loader/types"
import type { McpClient, McpTransport, SkillMcpClientInfo, SkillMcpManagerState } from "./types"
import { disconnectAll } from "./cleanup"
import { getOrCreateClient } from "./connection"
import { setStdioClientDependenciesForTesting } from "./stdio-client"

/**
 * This test proves a real-world bug: when the OMO plugin reloads (triggered by a
 * new OpenCode session opening in a different directory), `disconnectAll()` is called
 * on the SkillMcpManager via `plugin-dispose`. This sets `state.disposed = true`
 * permanently, so every subsequent `skill_mcp()` call from sessions that were
 * active BEFORE the reload fails with "has been shut down, cannot create new
 * connections."
 *
 * The plugin function (`OhMyOpenCodePlugin` in index.ts) is called once per session
 * directory. Each call disposes the previous plugin via a module-level singleton
 * `activePluginDispose`. Since the SkillMcpManager is recreated each time, the NEW
 * session gets a fresh manager — but OLD sessions still hold closures over the
 * disposed manager.
 *
 * The desired behavior: cleaning up all connections (e.g. during a plugin reload)
 * should NOT permanently prevent the manager from accepting new connections.
 * Sessions that survive a reload should be able to reconnect.
 */

const trackedStates: SkillMcpManagerState[] = []

function createMockClient(): McpClient {
  return {
    close: mock(async () => {}),
    connect: mock(async () => {}),
  } as unknown as McpClient
}

function createMockTransport(): McpTransport {
  return {
    close: mock(async () => {}),
  } as unknown as McpTransport
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
    serverName: "whatsapp",
    skillName: "whatsapp-skill",
    sessionID,
  }
}

function createClientKey(info: SkillMcpClientInfo): string {
  return `${info.sessionID}:${info.skillName}:${info.serverName}`
}

const stdioConfig: ClaudeCodeMcpServer = {
  command: "mock-whatsapp-mcp",
}

beforeEach(() => {
  setStdioClientDependenciesForTesting({
    createClient: () => createMockClient(),
    createTransport: () => createMockTransport(),
  })
})

afterEach(async () => {
  setStdioClientDependenciesForTesting()
  for (const state of trackedStates) {
    state.disposed = false
    for (const managed of state.clients.values()) {
      try {
        await managed.client.close()
      } catch {} // no-excuse-ok: catch — best-effort teardown; mock client may already be closed
      try {
        await managed.transport.close()
      } catch {} // no-excuse-ok: catch — best-effort teardown; mock transport may already be closed
    }
    state.clients.clear()
    state.pendingConnections.clear()
  }
  trackedStates.length = 0
})

describe("MCP manager survival across plugin reload", () => {
  it("#given session A has an active MCP connection #when plugin reloads (disconnectAll) #then session A can still create new connections", async () => {
    // given: session A established an MCP connection (e.g. WhatsApp)
    const state = createState()
    const sessionAInfo = createClientInfo("ses_session_a")
    const clientKey = createClientKey(sessionAInfo)

    const initialClient = await getOrCreateClient({
      state,
      clientKey,
      info: sessionAInfo,
      config: stdioConfig,
    })
    expect(initialClient).toBeDefined()
    expect(state.clients.has(clientKey)).toBe(true)

    // when: plugin reloads because a new session opened in a different directory.
    // In production, index.ts line 37 calls `await activePluginDispose?.()` which
    // calls `skillMcpManager.disconnectAll()` via plugin-dispose.ts line 33.
    // This sets state.disposed = true permanently.
    await disconnectAll(state)

    // then: session A should be able to reconnect.
    // The old session's tools still reference this manager instance — there is no
    // mechanism for OpenCode to replace tool closures in existing sessions after a
    // plugin reload. So the manager must accept new connections.
    const reconnectedClient = await getOrCreateClient({
      state,
      clientKey,
      info: sessionAInfo,
      config: stdioConfig,
    })
    expect(reconnectedClient).toBeDefined()
  })

  it("#given no prior connections #when disconnectAll was called (plugin reload) #then new connections should still be possible", async () => {
    // given: a manager that was part of a previous plugin load cycle
    const state = createState()
    await disconnectAll(state)

    // when: a session that survived the reload tries to use MCP
    const info = createClientInfo("ses_surviving_session")
    const clientKey = createClientKey(info)

    // then: it should succeed, not throw "has been shut down"
    const client = await getOrCreateClient({
      state,
      clientKey,
      info,
      config: stdioConfig,
    })
    expect(client).toBeDefined()
  })
})
