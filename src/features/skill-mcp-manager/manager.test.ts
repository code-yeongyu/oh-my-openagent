import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test"
import { SkillMcpManager } from "./manager"
import type { SkillMcpClientInfo, SkillMcpServerContext } from "./types"
import type { ClaudeCodeMcpServer } from "../claude-code-mcp-loader/types"

// Mock the MCP SDK transports to avoid network calls
const mockHttpConnect = mock(() => Promise.reject(new Error("Mocked HTTP connection failure")))
const mockHttpClose = mock(() => Promise.resolve())
let lastTransportInstance: { url?: URL; options?: { requestInit?: RequestInit } } = {}

mock.module("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class MockStreamableHTTPClientTransport {
    constructor(public url: URL, public options?: { requestInit?: RequestInit }) {
      lastTransportInstance = { url, options }
    }
    async start() {
      await mockHttpConnect()
    }
    async close() {
      await mockHttpClose()
    }
  },
}))

const mockTokens = mock(() => null as { accessToken: string; refreshToken?: string; expiresAt?: number } | null)
const mockLogin = mock(() => Promise.resolve({ accessToken: "new-token" }))

mock.module("../mcp-oauth/provider", () => ({
  McpOAuthProvider: class MockMcpOAuthProvider {
    constructor(public options: { serverUrl: string; clientId?: string; scopes?: string[] }) {}
    tokens() {
      return mockTokens()
    }
    async login() {
      return mockLogin()
    }
  },
}))














describe("SkillMcpManager", () => {
  let manager: SkillMcpManager

  beforeEach(() => {
    manager = new SkillMcpManager()
    mockHttpConnect.mockClear()
    mockHttpClose.mockClear()
  })

  afterEach(async () => {
    await manager.disconnectAll()
  })

  describe("getOrCreateClient", () => {
    describe("configuration validation", () => {
      it("throws error when neither url nor command is provided", async () => {
        // #given
        const info: SkillMcpClientInfo = {
          serverName: "test-server",
          skillName: "test-skill",
          sessionID: "session-1",
        }
        const config: ClaudeCodeMcpServer = {}

        // #when / #then
        await expect(manager.getOrCreateClient(info, config)).rejects.toThrow(
          /no valid connection configuration/
        )
      })

      it("includes both HTTP and stdio examples in error message", async () => {
        // #given
        const info: SkillMcpClientInfo = {
          serverName: "my-mcp",
          skillName: "data-skill",
          sessionID: "session-1",
        }
        const config: ClaudeCodeMcpServer = {}

        // #when / #then
        await expect(manager.getOrCreateClient(info, config)).rejects.toThrow(
          /HTTP[\s\S]*Stdio/
        )
      })

      it("includes server and skill names in error message", async () => {
        // #given
        const info: SkillMcpClientInfo = {
          serverName: "custom-server",
          skillName: "custom-skill",
          sessionID: "session-1",
        }
        const config: ClaudeCodeMcpServer = {}

        // #when / #then
        await expect(manager.getOrCreateClient(info, config)).rejects.toThrow(
          /custom-server[\s\S]*custom-skill/
        )
      })
    })

    describe("connection type detection", () => {
      it("detects HTTP connection from explicit type='http'", async () => {
        // #given
        const info: SkillMcpClientInfo = {
          serverName: "http-server",
          skillName: "test-skill",
          sessionID: "session-1",
        }
        const config: ClaudeCodeMcpServer = {
          type: "http",
          url: "https://example.com/mcp",
        }

        // #when / #then - should fail at connection, not config validation
        await expect(manager.getOrCreateClient(info, config)).rejects.toThrow(
          /Failed to connect/
        )
      })

      it("detects HTTP connection from explicit type='sse'", async () => {
        // #given
        const info: SkillMcpClientInfo = {
          serverName: "sse-server",
          skillName: "test-skill",
          sessionID: "session-1",
        }
        const config: ClaudeCodeMcpServer = {
          type: "sse",
          url: "https://example.com/mcp",
        }

        // #when / #then - should fail at connection, not config validation
        await expect(manager.getOrCreateClient(info, config)).rejects.toThrow(
          /Failed to connect/
        )
      })

      it("detects HTTP connection from url field when type is not specified", async () => {
        // #given
        const info: SkillMcpClientInfo = {
          serverName: "inferred-http",
          skillName: "test-skill",
          sessionID: "session-1",
        }
        const config: ClaudeCodeMcpServer = {
          url: "https://example.com/mcp",
        }

        // #when / #then - should fail at connection, not config validation
        await expect(manager.getOrCreateClient(info, config)).rejects.toThrow(
          /Failed to connect[\s\S]*URL/
        )
      })

      it("detects stdio connection from explicit type='stdio'", async () => {
        // #given
        const info: SkillMcpClientInfo = {
          serverName: "stdio-server",
          skillName: "test-skill",
          sessionID: "session-1",
        }
        const config: ClaudeCodeMcpServer = {
          type: "stdio",
          command: "node",
          args: ["-e", "process.exit(0)"],
        }

        // #when / #then - should fail at connection, not config validation
        await expect(manager.getOrCreateClient(info, config)).rejects.toThrow(
          /Failed to connect[\s\S]*Command/
        )
      })

      it("detects stdio connection from command field when type is not specified", async () => {
        // #given
        const info: SkillMcpClientInfo = {
          serverName: "inferred-stdio",
          skillName: "test-skill",
          sessionID: "session-1",
        }
        const config: ClaudeCodeMcpServer = {
          command: "node",
          args: ["-e", "process.exit(0)"],
        }

        // #when / #then - should fail at connection, not config validation
        await expect(manager.getOrCreateClient(info, config)).rejects.toThrow(
          /Failed to connect[\s\S]*Command/
        )
      })

      it("prefers explicit type over inferred type", async () => {
        // #given - has both url and command, but type is explicitly stdio
        const info: SkillMcpClientInfo = {
          serverName: "mixed-config",
          skillName: "test-skill",
          sessionID: "session-1",
        }
        const config: ClaudeCodeMcpServer = {
          type: "stdio",
          url: "https://example.com/mcp", // should be ignored
          command: "node",
          args: ["-e", "process.exit(0)"],
        }

        // #when / #then - should use stdio (show Command in error, not URL)
        await expect(manager.getOrCreateClient(info, config)).rejects.toThrow(
          /Command: node/
        )
      })
    })

    describe("HTTP connection", () => {
      it("throws error for invalid URL", async () => {
        // #given
        const info: SkillMcpClientInfo = {
          serverName: "bad-url-server",
          skillName: "test-skill",
          sessionID: "session-1",
        }
        const config: ClaudeCodeMcpServer = {
          type: "http",
          url: "not-a-valid-url",
        }

        // #when / #then
        await expect(manager.getOrCreateClient(info, config)).rejects.toThrow(
          /invalid URL/
        )
      })

      it("includes URL in HTTP connection error", async () => {
        // #given
        const info: SkillMcpClientInfo = {
          serverName: "http-error-server",
          skillName: "test-skill",
          sessionID: "session-1",
        }
        const config: ClaudeCodeMcpServer = {
          url: "https://nonexistent.example.com/mcp",
        }

        // #when / #then
        await expect(manager.getOrCreateClient(info, config)).rejects.toThrow(
          /https:\/\/nonexistent\.example\.com\/mcp/
        )
      })

      it("includes helpful hints for HTTP connection failures", async () => {
        // #given
        const info: SkillMcpClientInfo = {
          serverName: "hint-server",
          skillName: "test-skill",
          sessionID: "session-1",
        }
        const config: ClaudeCodeMcpServer = {
          url: "https://nonexistent.example.com/mcp",
        }

        // #when / #then
        await expect(manager.getOrCreateClient(info, config)).rejects.toThrow(
          /Hints[\s\S]*Verify the URL[\s\S]*authentication headers[\s\S]*MCP over HTTP/
        )
      })

      it("calls mocked transport connect for HTTP connections", async () => {
        // #given
        const info: SkillMcpClientInfo = {
          serverName: "mock-test-server",
          skillName: "test-skill",
          sessionID: "session-1",
        }
        const config: ClaudeCodeMcpServer = {
          url: "https://example.com/mcp",
        }

        // #when
        try {
          await manager.getOrCreateClient(info, config)
        } catch {
          // Expected to fail
        }

        // #then - verify mock was called (transport was instantiated)
        // The connection attempt happens through the Client.connect() which
        // internally calls transport.start()
        expect(mockHttpConnect).toHaveBeenCalled()
      })
    })

    describe("stdio connection (backward compatibility)", () => {
      it("throws error when command is missing for stdio type", async () => {
        // #given
        const info: SkillMcpClientInfo = {
          serverName: "missing-command",
          skillName: "test-skill",
          sessionID: "session-1",
        }
        const config: ClaudeCodeMcpServer = {
          type: "stdio",
          // command is missing
        }

        // #when / #then
        await expect(manager.getOrCreateClient(info, config)).rejects.toThrow(
          /missing 'command' field/
        )
      })

      it("includes command in stdio connection error", async () => {
        // #given
        const info: SkillMcpClientInfo = {
          serverName: "test-server",
          skillName: "test-skill",
          sessionID: "session-1",
        }
        const config: ClaudeCodeMcpServer = {
          command: "nonexistent-command-xyz",
          args: ["--foo"],
        }

        // #when / #then
        await expect(manager.getOrCreateClient(info, config)).rejects.toThrow(
          /nonexistent-command-xyz --foo/
        )
      })

      it("includes helpful hints for stdio connection failures", async () => {
        // #given
        const info: SkillMcpClientInfo = {
          serverName: "test-server",
          skillName: "test-skill",
          sessionID: "session-1",
        }
        const config: ClaudeCodeMcpServer = {
          command: "nonexistent-command",
        }

        // #when / #then
        await expect(manager.getOrCreateClient(info, config)).rejects.toThrow(
          /Hints[\s\S]*PATH[\s\S]*package exists/
        )
      })
    })
  })

  describe("disconnectSession", () => {
    it("removes all clients for a specific session", async () => {
      // #given
      const session1Info: SkillMcpClientInfo = {
        serverName: "server1",
        skillName: "skill1",
        sessionID: "session-1",
      }
      const session2Info: SkillMcpClientInfo = {
        serverName: "server1",
        skillName: "skill1",
        sessionID: "session-2",
      }

      // #when
      await manager.disconnectSession("session-1")

      // #then
      expect(manager.isConnected(session1Info)).toBe(false)
      expect(manager.isConnected(session2Info)).toBe(false)
    })

    it("does not throw when session has no clients", async () => {
      // #given / #when / #then
      await expect(manager.disconnectSession("nonexistent")).resolves.toBeUndefined()
    })
  })

  describe("disconnectAll", () => {
    it("clears all clients", async () => {
      // #given - no actual clients connected (would require real MCP server)

      // #when
      await manager.disconnectAll()

      // #then
      expect(manager.getConnectedServers()).toEqual([])
    })
  })

  describe("isConnected", () => {
    it("returns false for unconnected server", () => {
      // #given
      const info: SkillMcpClientInfo = {
        serverName: "unknown",
        skillName: "test",
        sessionID: "session-1",
      }

      // #when / #then
      expect(manager.isConnected(info)).toBe(false)
    })
  })

  describe("getConnectedServers", () => {
    it("returns empty array when no servers connected", () => {
      // #given / #when / #then
      expect(manager.getConnectedServers()).toEqual([])
    })
  })

  describe("environment variable handling", () => {
    it("always inherits process.env even when config.env is undefined", async () => {
      // #given
      const info: SkillMcpClientInfo = {
        serverName: "test-server",
        skillName: "test-skill",
        sessionID: "session-1",
      }
      const configWithoutEnv: ClaudeCodeMcpServer = {
        command: "node",
        args: ["-e", "process.exit(0)"],
      }

      // #when - attempt connection (will fail but exercises env merging code path)
      // #then - should not throw "undefined" related errors for env
      try {
        await manager.getOrCreateClient(info, configWithoutEnv)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        expect(message).not.toContain("env")
        expect(message).not.toContain("undefined")
      }
    })

    it("overlays config.env on top of inherited process.env", async () => {
      // #given
      const info: SkillMcpClientInfo = {
        serverName: "test-server",
        skillName: "test-skill",
        sessionID: "session-2",
      }
      const configWithEnv: ClaudeCodeMcpServer = {
        command: "node",
        args: ["-e", "process.exit(0)"],
        env: {
          CUSTOM_VAR: "custom_value",
        },
      }

      // #when - attempt connection
      // #then - should not throw, env merging should work
      try {
        await manager.getOrCreateClient(info, configWithEnv)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        expect(message).toContain("Failed to connect")
      }
    })
  })

  describe("HTTP headers handling", () => {
    it("accepts configuration with headers", async () => {
      // #given
      const info: SkillMcpClientInfo = {
        serverName: "auth-server",
        skillName: "test-skill",
        sessionID: "session-1",
      }
      const config: ClaudeCodeMcpServer = {
        url: "https://example.com/mcp",
        headers: {
          Authorization: "Bearer test-token",
          "X-Custom-Header": "custom-value",
        },
      }

      // #when / #then - should fail at connection, not config validation
      // Headers are passed through to the transport
      await expect(manager.getOrCreateClient(info, config)).rejects.toThrow(
        /Failed to connect/
      )

      // Verify headers were forwarded to transport
      expect(lastTransportInstance.options?.requestInit?.headers).toEqual({
        Authorization: "Bearer test-token",
        "X-Custom-Header": "custom-value",
      })
    })

    it("works without headers (optional)", async () => {
      // #given
      const info: SkillMcpClientInfo = {
        serverName: "no-auth-server",
        skillName: "test-skill",
        sessionID: "session-1",
      }
      const config: ClaudeCodeMcpServer = {
        url: "https://example.com/mcp",
        // no headers
      }

      // #when / #then - should fail at connection, not config validation
      await expect(manager.getOrCreateClient(info, config)).rejects.toThrow(
        /Failed to connect/
      )
    })
  })

  describe("operation retry logic", () => {
    it("should retry operation when 'Not connected' error occurs", async () => {
      // #given
      const info: SkillMcpClientInfo = {
        serverName: "retry-server",
        skillName: "retry-skill",
        sessionID: "session-retry-1",
      }
      const context: SkillMcpServerContext = {
        config: {
          url: "https://example.com/mcp",
        },
        skillName: "retry-skill",
      }

      let callCount = 0
      const mockClient = {
        callTool: mock(async () => {
          callCount++
          if (callCount === 1) {
            throw new Error("Not connected")
          }
          return { content: [{ type: "text", text: "success" }] }
        }),
        close: mock(() => Promise.resolve()),
      }

      const getOrCreateSpy = spyOn(manager as any, "getOrCreateClientWithRetry")
      getOrCreateSpy.mockResolvedValue(mockClient)

      // #when
      const result = await manager.callTool(info, context, "test-tool", {})

      // #then
      expect(callCount).toBe(2)
      expect(result).toEqual([{ type: "text", text: "success" }])
      expect(getOrCreateSpy).toHaveBeenCalledTimes(2)
    })

    it("should fail after 3 retry attempts", async () => {
      // #given
      const info: SkillMcpClientInfo = {
        serverName: "fail-server",
        skillName: "fail-skill",
        sessionID: "session-fail-1",
      }
      const context: SkillMcpServerContext = {
        config: {
          url: "https://example.com/mcp",
        },
        skillName: "fail-skill",
      }

      const mockClient = {
        callTool: mock(async () => {
          throw new Error("Not connected")
        }),
        close: mock(() => Promise.resolve()),
      }

      const getOrCreateSpy = spyOn(manager as any, "getOrCreateClientWithRetry")
      getOrCreateSpy.mockResolvedValue(mockClient)

      // #when / #then
      await expect(manager.callTool(info, context, "test-tool", {})).rejects.toThrow(
        /Failed after 3 reconnection attempts/
      )
      expect(getOrCreateSpy).toHaveBeenCalledTimes(3)
    })

    it("should not retry on non-connection errors", async () => {
      // #given
      const info: SkillMcpClientInfo = {
        serverName: "error-server",
        skillName: "error-skill",
        sessionID: "session-error-1",
      }
      const context: SkillMcpServerContext = {
        config: {
          url: "https://example.com/mcp",
        },
        skillName: "error-skill",
      }

      const mockClient = {
        callTool: mock(async () => {
          throw new Error("Tool not found")
        }),
        close: mock(() => Promise.resolve()),
      }

      const getOrCreateSpy = spyOn(manager as any, "getOrCreateClientWithRetry")
      getOrCreateSpy.mockResolvedValue(mockClient)

      // #when / #then
      await expect(manager.callTool(info, context, "test-tool", {})).rejects.toThrow(
        "Tool not found"
      )
      expect(getOrCreateSpy).toHaveBeenCalledTimes(1)
    })
  })

  describe("OAuth integration", () => {
    beforeEach(() => {
      mockTokens.mockClear()
      mockLogin.mockClear()
    })

    it("injects Authorization header when oauth config has stored tokens", async () => {
      // #given
      const info: SkillMcpClientInfo = {
        serverName: "oauth-server",
        skillName: "oauth-skill",
        sessionID: "session-oauth-1",
      }
      const config: ClaudeCodeMcpServer = {
        url: "https://mcp.example.com/mcp",
        oauth: {
          clientId: "my-client",
          scopes: ["read", "write"],
        },
      }
      mockTokens.mockReturnValue({ accessToken: "stored-access-token" })

      // #when
      try {
        await manager.getOrCreateClient(info, config)
      } catch { /* connection fails in test */ }

      // #then
      const headers = lastTransportInstance.options?.requestInit?.headers as Record<string, string> | undefined
      expect(headers?.Authorization).toBe("Bearer stored-access-token")
    })

    it("does not inject Authorization header when no stored tokens exist and login fails", async () => {
      // #given
      const info: SkillMcpClientInfo = {
        serverName: "oauth-no-token",
        skillName: "oauth-skill",
        sessionID: "session-oauth-2",
      }
      const config: ClaudeCodeMcpServer = {
        url: "https://mcp.example.com/mcp",
        oauth: {
          clientId: "my-client",
        },
      }
      mockTokens.mockReturnValue(null)
      mockLogin.mockRejectedValue(new Error("Login failed"))

      // #when
      try {
        await manager.getOrCreateClient(info, config)
      } catch { /* connection fails in test */ }

      // #then
      const headers = lastTransportInstance.options?.requestInit?.headers as Record<string, string> | undefined
      expect(headers?.Authorization).toBeUndefined()
    })

    it("preserves existing static headers alongside OAuth token", async () => {
      // #given
      const info: SkillMcpClientInfo = {
        serverName: "oauth-with-headers",
        skillName: "oauth-skill",
        sessionID: "session-oauth-3",
      }
      const config: ClaudeCodeMcpServer = {
        url: "https://mcp.example.com/mcp",
        headers: {
          "X-Custom": "custom-value",
        },
        oauth: {
          clientId: "my-client",
        },
      }
      mockTokens.mockReturnValue({ accessToken: "oauth-token" })

      // #when
      try {
        await manager.getOrCreateClient(info, config)
      } catch { /* connection fails in test */ }

      // #then
      const headers = lastTransportInstance.options?.requestInit?.headers as Record<string, string> | undefined
      expect(headers?.["X-Custom"]).toBe("custom-value")
      expect(headers?.Authorization).toBe("Bearer oauth-token")
    })

    it("does not create auth provider when oauth config is absent", async () => {
      // #given
      const info: SkillMcpClientInfo = {
        serverName: "no-oauth-server",
        skillName: "test-skill",
        sessionID: "session-no-oauth",
      }
      const config: ClaudeCodeMcpServer = {
        url: "https://mcp.example.com/mcp",
        headers: {
          Authorization: "Bearer static-token",
        },
      }

      // #when
      try {
        await manager.getOrCreateClient(info, config)
      } catch { /* connection fails in test */ }

      // #then
      const headers = lastTransportInstance.options?.requestInit?.headers as Record<string, string> | undefined
      expect(headers?.Authorization).toBe("Bearer static-token")
      expect(mockTokens).not.toHaveBeenCalled()
    })

    it("handles step-up auth by triggering re-login on 403 with scope", async () => {
      // #given
      const info: SkillMcpClientInfo = {
        serverName: "stepup-server",
        skillName: "stepup-skill",
        sessionID: "session-stepup-1",
      }
      const config: ClaudeCodeMcpServer = {
        url: "https://mcp.example.com/mcp",
        oauth: {
          clientId: "my-client",
          scopes: ["read"],
        },
      }
      const context: SkillMcpServerContext = {
        config,
        skillName: "stepup-skill",
      }

      mockTokens.mockReturnValue({ accessToken: "initial-token" })
      mockLogin.mockResolvedValue({ accessToken: "upgraded-token" })

      let callCount = 0
      const mockClient = {
        callTool: mock(async () => {
          callCount++
          if (callCount === 1) {
            throw new Error('403 WWW-Authenticate: Bearer scope="admin write"')
          }
          return { content: [{ type: "text", text: "success" }] }
        }),
        close: mock(() => Promise.resolve()),
      }

      const getOrCreateSpy = spyOn(manager as any, "getOrCreateClientWithRetry")
      getOrCreateSpy.mockResolvedValue(mockClient)

      // #when
      const result = await manager.callTool(info, context, "test-tool", {})

      // #then
      expect(result).toEqual([{ type: "text", text: "success" }])
      expect(mockLogin).toHaveBeenCalled()
    })

    it("does not attempt step-up when oauth config is absent", async () => {
      // #given
      const info: SkillMcpClientInfo = {
        serverName: "no-stepup-server",
        skillName: "no-stepup-skill",
        sessionID: "session-no-stepup",
      }
      const context: SkillMcpServerContext = {
        config: {
          url: "https://mcp.example.com/mcp",
        },
        skillName: "no-stepup-skill",
      }

      const mockClient = {
        callTool: mock(async () => {
          throw new Error('403 WWW-Authenticate: Bearer scope="admin"')
        }),
        close: mock(() => Promise.resolve()),
      }

      const getOrCreateSpy = spyOn(manager as any, "getOrCreateClientWithRetry")
      getOrCreateSpy.mockResolvedValue(mockClient)

      // #when / #then
      await expect(manager.callTool(info, context, "test-tool", {})).rejects.toThrow(/403/)
      expect(mockLogin).not.toHaveBeenCalled()
    })
  })
})
