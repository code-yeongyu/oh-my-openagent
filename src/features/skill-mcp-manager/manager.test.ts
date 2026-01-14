import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test"
import { SkillMcpManager } from "./manager"
import type { SkillMcpClientInfo, SkillMcpServerContext } from "./types"
import type { ClaudeCodeMcpServer } from "../claude-code-mcp-loader/types"

describe("SkillMcpManager", () => {
  let manager: SkillMcpManager

  beforeEach(() => {
    manager = new SkillMcpManager()
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
})
