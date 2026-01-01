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
    it("throws error when command is missing", async () => {
      // #given
      const info: SkillMcpClientInfo = {
        serverName: "test-server",
        skillName: "test-skill",
        sessionID: "session-1",
      }
      const config: ClaudeCodeMcpServer = {}

      // #when / #then
      await expect(manager.getOrCreateClient(info, config)).rejects.toThrow(
        /missing required 'command' field/
      )
    })

    it("includes helpful error message with example when command is missing", async () => {
      // #given
      const info: SkillMcpClientInfo = {
        serverName: "my-mcp",
        skillName: "data-skill",
        sessionID: "session-1",
      }
      const config: ClaudeCodeMcpServer = {}

      // #when / #then
      await expect(manager.getOrCreateClient(info, config)).rejects.toThrow(
        /my-mcp[\s\S]*data-skill[\s\S]*Example/
      )
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
})
