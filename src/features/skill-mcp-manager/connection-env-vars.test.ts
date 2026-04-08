import { afterAll, afterEach, beforeEach, describe, expect, it, mock, test } from "bun:test"
import type { ClaudeCodeMcpServer } from "../claude-code-mcp-loader/types"
import type { SkillMcpClientInfo, SkillMcpManagerState } from "./types"

const trackedStates: SkillMcpManagerState[] = []
const createdStdioTransports: MockStdioClientTransport[] = []
const createdHttpTransports: MockStreamableHTTPClientTransport[] = []

class MockClient {
  readonly close = mock(async () => {})

  constructor(
    _clientInfo: { name: string; version: string },
    _options: { capabilities: Record<string, never> }
  ) {}

  async connect(_transport: unknown): Promise<void> {
    // Successful connect, env-related assertions happen on transport constructor args
  }
}

class MockStdioClientTransport {
  readonly close = mock(async () => {})
  readonly options: { command: string; args?: string[]; env?: Record<string, string>; stderr?: string }

  constructor(options: { command: string; args?: string[]; env?: Record<string, string>; stderr?: string }) {
    this.options = options
    createdStdioTransports.push(this)
  }
}

interface MockHttpTransportOptions {
  requestInit?: { headers?: Record<string, string> }
}

class MockStreamableHTTPClientTransport {
  readonly close = mock(async () => {})
  readonly url: URL
  readonly options?: MockHttpTransportOptions

  constructor(url: URL, options?: MockHttpTransportOptions) {
    this.url = url
    this.options = options
    createdHttpTransports.push(this)
  }

  async start() {}
}

mock.module("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: MockClient,
}))

mock.module("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: MockStdioClientTransport,
}))

mock.module("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: MockStreamableHTTPClientTransport,
}))

afterAll(() => {
  mock.restore()
})

const { disconnectAll } = await import("./cleanup")
const { getOrCreateClient } = await import("./connection")

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

function createClientInfo(
  serverName: string,
  scope?: SkillMcpClientInfo["scope"],
): SkillMcpClientInfo {
  return {
    serverName,
    skillName: "env-skill",
    sessionID: "session-env",
    ...(scope !== undefined ? { scope } : {}),
  }
}

function createClientKey(info: SkillMcpClientInfo): string {
  return `${info.sessionID}:${info.skillName}:${info.serverName}`
}

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  createdStdioTransports.length = 0
  createdHttpTransports.length = 0
})

afterEach(async () => {
  for (const state of trackedStates) {
    await disconnectAll(state)
  }
  trackedStates.length = 0

  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key]
    }
  }
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    process.env[key] = value
  }
})

describe("getOrCreateClient env var expansion", () => {
  describe("#given a scope-sensitive stdio skill MCP config", () => {
    test.each([
      ["opencode-project", "Authorization:Bearer "],
      ["local", "Authorization:Bearer "],
      ["user", "Authorization:Bearer xoxp-scope-token"],
      ["builtin", "Authorization:Bearer xoxp-scope-token"],
    ] satisfies Array<[NonNullable<SkillMcpClientInfo["scope"]>, string]>) (
      "#when creating the client for %s scope #then args expand to %s",
      async (scope, expectedAuthorizationHeader) => {
        // given
        process.env.SLACK_USER_TOKEN = "xoxp-scope-token"
        const state = createState()
        const info = createClientInfo(`scope-${scope}`, scope)
        const clientKey = createClientKey(info)
        const config: ClaudeCodeMcpServer = {
          command: "npx",
          args: [
            "-y",
            "mcp-remote",
            "https://mcp.slack.com/mcp",
            "--header",
            "Authorization:Bearer ${SLACK_USER_TOKEN}",
          ],
        }

        // when
        await getOrCreateClient({ state, clientKey, info, config })

        // then
        expect(createdStdioTransports).toHaveLength(1)
        expect(createdStdioTransports[0]?.options.args?.[4]).toBe(expectedAuthorizationHeader)
      },
    )

    it("#when creating the client without scope #then env vars remain trusted for backward compatibility", async () => {
      // given
      process.env.SLACK_USER_TOKEN = "xoxp-undefined-scope-token"
      const state = createState()
      const info = createClientInfo("scope-undefined")
      const clientKey = createClientKey(info)
      const config: ClaudeCodeMcpServer = {
        command: "npx",
        args: [
          "-y",
          "mcp-remote",
          "https://mcp.slack.com/mcp",
          "--header",
          "Authorization:Bearer ${SLACK_USER_TOKEN}",
        ],
      }

      // when
      await getOrCreateClient({ state, clientKey, info, config })

      // then
      expect(createdStdioTransports).toHaveLength(1)
      expect(createdStdioTransports[0]?.options.args?.[4]).toBe(
        "Authorization:Bearer xoxp-undefined-scope-token",
      )
    })
  })

  describe("#given a stdio skill MCP config with sensitive env vars in args", () => {
    it("#when creating the client #then sensitive env vars in args are expanded", async () => {
      // given
      process.env.SLACK_USER_TOKEN = "xoxp-secret-token"
      const state = createState()
      const info = createClientInfo("slack-stdio")
      const clientKey = createClientKey(info)
      const config: ClaudeCodeMcpServer = {
        command: "npx",
        args: [
          "-y",
          "mcp-remote",
          "https://mcp.slack.com/mcp",
          "--header",
          "Authorization:Bearer ${SLACK_USER_TOKEN}",
        ],
      }

      // when
      await getOrCreateClient({ state, clientKey, info, config })

      // then
      expect(createdStdioTransports).toHaveLength(1)
      expect(createdStdioTransports[0]?.options.args).toEqual([
        "-y",
        "mcp-remote",
        "https://mcp.slack.com/mcp",
        "--header",
        "Authorization:Bearer xoxp-secret-token",
      ])
    })
  })

  describe("#given a stdio skill MCP config with sensitive env vars in env map", () => {
    it("#when creating the client #then sensitive env vars in env map are expanded", async () => {
      // given
      process.env.MY_SLACK_USER_TOKEN_VALUE = "token-123"
      const state = createState()
      const info = createClientInfo("env-stdio")
      const clientKey = createClientKey(info)
      const config: ClaudeCodeMcpServer = {
        command: "node",
        args: ["server.js"],
        env: {
          SLACK_BOT_USER_ID: "${MY_SLACK_USER_TOKEN_VALUE}",
        },
      }

      // when
      await getOrCreateClient({ state, clientKey, info, config })

      // then
      expect(createdStdioTransports).toHaveLength(1)
      expect(createdStdioTransports[0]?.options.env?.SLACK_BOT_USER_ID).toBe("token-123")
    })
  })

  describe("#given an http skill MCP config with sensitive env vars in headers", () => {
    it("#when creating the client #then sensitive env vars in headers are expanded", async () => {
      // given
      process.env.SLACK_USER_TOKEN = "xoxp-http-secret"
      const state = createState()
      const info = createClientInfo("slack-http")
      const clientKey = createClientKey(info)
      const config: ClaudeCodeMcpServer = {
        url: "https://mcp.slack.com/mcp",
        headers: {
          Authorization: "Bearer ${SLACK_USER_TOKEN}",
        },
      }

      // when
      await getOrCreateClient({ state, clientKey, info, config })

      // then
      expect(createdHttpTransports).toHaveLength(1)
      expect(createdHttpTransports[0]?.options?.requestInit?.headers?.Authorization).toBe(
        "Bearer xoxp-http-secret"
      )
    })
  })
})
