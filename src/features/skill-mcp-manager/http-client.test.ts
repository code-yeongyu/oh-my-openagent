import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import type { ClaudeCodeMcpServer } from "../claude-code-mcp-loader/types"
import { _flushForTesting, _resetLoggerForTesting, _setLoggerForTesting } from "../../shared/logger"
import { disconnectAll } from "./cleanup"
import { createHttpClient, setHttpClientDependenciesForTesting } from "./http-client"
import type { McpTransport, SkillMcpClientInfo, SkillMcpManagerState } from "./types"

const trackedStates: SkillMcpManagerState[] = []
const createdClients: MockHttpClient[] = []
const createdTransports: MockHttpTransport[] = []
let configureNextClient: ((client: MockHttpClient) => void) | undefined
let configureNextTransport: ((transport: MockHttpTransport) => void) | undefined
let testLogDir: string | undefined

class MockHttpClient {
  readonly close = mock(async () => {})
  readonly listTools = mock(async () => ({ tools: [] }))
  readonly listResources = mock(async () => ({ resources: [] }))
  readonly listPrompts = mock(async () => ({ prompts: [] }))
  readonly callTool = mock(async () => ({ content: [] }))
  readonly readResource = mock(async () => ({ contents: [] }))
  readonly getPrompt = mock(async () => ({ messages: [] }))
  readonly connect = mock(async (_transport: McpTransport) => {})

  constructor(
    _clientInfo: { name: string; version: string },
    _options: { capabilities: Record<string, never> },
  ) {
    createdClients.push(this)
    configureNextClient?.(this)
  }
}

class MockHttpTransport {
  readonly close = mock(async () => {})
  readonly send = mock(async () => {})

  constructor(
    readonly url: URL,
    readonly options?: { requestInit?: RequestInit },
  ) {
    createdTransports.push(this)
    configureNextTransport?.(this)
  }

  async start(): Promise<void> {}
}

afterAll(() => {
  mock.restore()
})

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
    createOAuthProvider: () => ({
      tokens: () => null,
      login: async () => ({ accessToken: "test-token" }),
      refresh: async () => ({ accessToken: "test-token" }),
    }),
  }

  trackedStates.push(state)
  return state
}

function createInfo(): SkillMcpClientInfo {
  return {
    serverName: "http-cleanup-server",
    skillName: "http-cleanup-skill",
    sessionID: "session-http-cleanup",
    scope: "builtin",
  }
}

function createClientKey(info: SkillMcpClientInfo): string {
  return `${info.sessionID}:${info.skillName}:${info.serverName}`
}

function createConfig(): ClaudeCodeMcpServer {
  return {
    type: "http",
    url: "https://example.com/mcp?api_key=secret-value",
  }
}

beforeEach(() => {
  createdClients.length = 0
  createdTransports.length = 0
  configureNextClient = undefined
  configureNextTransport = undefined
  testLogDir = undefined
  setHttpClientDependenciesForTesting({
    createClient: (clientInfo, options) => new MockHttpClient(clientInfo, options),
    createTransport: (url, options) => new MockHttpTransport(url, options),
  })
})

afterEach(async () => {
  for (const state of trackedStates) {
    await disconnectAll(state)
  }

  trackedStates.length = 0
  createdClients.length = 0
  createdTransports.length = 0
  configureNextClient = undefined
  configureNextTransport = undefined
  _resetLoggerForTesting()
  if (testLogDir) {
    fs.rmSync(testLogDir, { recursive: true, force: true })
    testLogDir = undefined
  }
  setHttpClientDependenciesForTesting()
})

describe("createHttpClient cleanup failures", () => {
  it("#given HTTP connect fails and transport close rejects #when creating the client #then the connection error is preserved", async () => {
    const state = createState()
    const info = createInfo()
    const clientKey = createClientKey(info)
    const config = createConfig()

    configureNextClient = (client) => {
      client.connect.mockImplementation(async () => {
        throw new Error("connect boom")
      })
    }
    configureNextTransport = (transport) => {
      transport.close.mockImplementation(async () => {
        throw new Error("cleanup boom")
      })
    }

    await expect(createHttpClient({ state, clientKey, info, config })).rejects.toThrow(
      /Failed to connect to MCP server "http-cleanup-server"[\s\S]*api_key=\*\*\*REDACTED\*\*\*[\s\S]*Reason: connect boom/,
    )
    expect(createdTransports[0]?.close).toHaveBeenCalledTimes(1)
    expect(state.clients.has(clientKey)).toBe(false)
  })

  it("#given HTTP connect failure includes URL and bearer secrets #when creating the client #then thrown reason redacts secrets", async () => {
    const state = createState()
    const info = createInfo()
    const clientKey = createClientKey(info)
    const config = createConfig()

    configureNextClient = (client) => {
      client.connect.mockImplementation(async () => {
        throw new Error(
          "connect failed for https://example.com/mcp?api_key=secret-value with Authorization: Bearer abcdefghijklmnopqrstuvwxyz",
        )
      })
    }

    let thrown: unknown
    try {
      await createHttpClient({ state, clientKey, info, config })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(Error)
    const message = thrown instanceof Error ? thrown.message : ""
    expect(message).toMatch(
      /Reason: connect failed for https:\/\/example\.com\/mcp\?api_key=\*\*\*REDACTED\*\*\* with Authorization: \[REDACTED\]/,
    )
    expect(message).not.toMatch(/secret-value|abcdefghijklmnopqrstuvwxyz/)
  })

  it("#given HTTP connect failure includes compact JSON secrets #when creating the client #then URL and bearer values are both redacted", async () => {
    const state = createState()
    const info = createInfo()
    const clientKey = createClientKey(info)
    const config = createConfig()

    configureNextClient = (client) => {
      client.connect.mockImplementation(async () => {
        throw new Error(
          '{"url":"https://example.com/mcp?api_key=secret-value","headers":{"Authorization":"Bearer abcdefghijklmnopqrstuvwxyz"}}',
        )
      })
    }

    let thrown: unknown
    try {
      await createHttpClient({ state, clientKey, info, config })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(Error)
    const message = thrown instanceof Error ? thrown.message : ""
    expect(message).toContain('"url":"https://example.com/mcp?api_key=***REDACTED***"')
    expect(message).toContain('"Authorization":"[REDACTED]"')
    expect(message).not.toMatch(/secret-value|abcdefghijklmnopqrstuvwxyz/)
  })

  it("#given HTTP connect failure includes non-bearer authorization secrets #when creating the client #then authorization values are redacted by key", async () => {
    const state = createState()
    const info = createInfo()
    const clientKey = createClientKey(info)
    const config = createConfig()

    configureNextClient = (client) => {
      client.connect.mockImplementation(async () => {
        throw new Error(
          '{"url":"https://example.com/mcp?api_key=secret-value","headers":{"Authorization":"Basic short-secret","authorization":"Bearer short"}}',
        )
      })
    }

    let thrown: unknown
    try {
      await createHttpClient({ state, clientKey, info, config })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(Error)
    const message = thrown instanceof Error ? thrown.message : ""
    expect(message).toContain('"url":"https://example.com/mcp?api_key=***REDACTED***"')
    expect(message).toContain('"Authorization":"[REDACTED]"')
    expect(message).toContain('"authorization":"[REDACTED]"')
    expect(message).not.toMatch(/secret-value|short-secret|Bearer short/)
  })

  it("#given HTTP connect failure includes authorization equals secrets #when creating the client #then full values are redacted", async () => {
    const state = createState()
    const info = createInfo()
    const clientKey = createClientKey(info)
    const config = createConfig()

    configureNextClient = (client) => {
      client.connect.mockImplementation(async () => {
        throw new Error("authorization=Basic short-secret; authorization=Bearer short")
      })
    }

    let thrown: unknown
    try {
      await createHttpClient({ state, clientKey, info, config })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(Error)
    const message = thrown instanceof Error ? thrown.message : ""
    expect(message).toContain("authorization=[REDACTED]; authorization=[REDACTED]")
    expect(message).not.toMatch(/short-secret|Bearer short/)
  })

  it("#given HTTP connect failure includes short sensitive header secrets #when creating the client #then header values are redacted by key", async () => {
    const state = createState()
    const info = createInfo()
    const clientKey = createClientKey(info)
    const config = createConfig()

    configureNextClient = (client) => {
      client.connect.mockImplementation(async () => {
        throw new Error(
          '{"headers":{"X-API-Key":"tiny","x-auth-token":"mini"},"detail":"api-key=short"}',
        )
      })
    }

    let thrown: unknown
    try {
      await createHttpClient({ state, clientKey, info, config })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(Error)
    const message = thrown instanceof Error ? thrown.message : ""
    expect(message).toContain('"X-API-Key":"[REDACTED]"')
    expect(message).toContain('"x-auth-token":"[REDACTED]"')
    expect(message).toContain("api-key=[REDACTED]")
    expect(message).not.toMatch(/tiny|mini|api-key=short/)
  })

  it("#given shutdown completes during HTTP connect and cleanup rejects #when creating the client #then the shutdown error is preserved", async () => {
    const state = createState()
    const info = createInfo()
    const clientKey = createClientKey(info)
    const config = createConfig()

    configureNextClient = (client) => {
      client.connect.mockImplementation(async () => {
        state.shutdownGeneration += 1
      })
      client.close.mockImplementation(async () => {
        throw new Error("client cleanup boom")
      })
    }
    configureNextTransport = (transport) => {
      transport.close.mockImplementation(async () => {
        throw new Error("transport cleanup boom")
      })
    }

    await expect(createHttpClient({ state, clientKey, info, config })).rejects.toThrow(
      /MCP server "http-cleanup-server" connection completed after shutdown/,
    )
    expect(createdClients[0]?.close).toHaveBeenCalledTimes(1)
    expect(createdTransports[0]?.close).toHaveBeenCalledTimes(1)
    expect(state.clients.has(clientKey)).toBe(false)
  })

  it("#given cleanup failure includes URL and bearer secrets #when the failure is logged #then secrets are redacted", async () => {
    const state = createState()
    const info = createInfo()
    const clientKey = createClientKey(info)
    const config = createConfig()
    testLogDir = fs.mkdtempSync(path.join(os.tmpdir(), "omo-http-client-cleanup-"))
    const logFilePath = path.join(testLogDir, "cleanup.log")

    _setLoggerForTesting({ filePath: logFilePath, maxSizeBytes: 1024 * 1024, maxBackups: 2 })
    configureNextClient = (client) => {
      client.connect.mockImplementation(async () => {
        throw new Error("connect boom")
      })
    }
    configureNextTransport = (transport) => {
      transport.close.mockImplementation(async () => {
        throw new Error(
          "cleanup failed for https://example.com/mcp?api_key=secret-value with Authorization: Bearer abcdefghijklmnopqrstuvwxyz",
        )
      })
    }

    await expect(createHttpClient({ state, clientKey, info, config })).rejects.toThrow(/connect boom/)
    _flushForTesting()

    const logContent = fs.readFileSync(logFilePath, "utf8")
    expect(logContent).toContain("ignored cleanup failure")
    expect(logContent).toContain("api_key=***REDACTED***")
    expect(logContent).toContain("Authorization: [REDACTED]")
    expect(logContent).not.toContain("secret-value")
    expect(logContent).not.toContain("abcdefghijklmnopqrstuvwxyz")
  })
})
