import { describe, it, expect, spyOn, afterEach } from "bun:test"
import * as mcp from "./mcp"

describe("mcp check", () => {
  describe("getBuiltinMcpInfo", () => {
    it("returns builtin servers", () => {
      // #given
      // #when getting builtin info
      const servers = mcp.getBuiltinMcpInfo()

      // #then should include expected servers
      expect(servers.length).toBe(2)
      expect(servers.every((s) => s.type === "builtin")).toBe(true)
      expect(servers.every((s) => s.enabled === true)).toBe(true)
      expect(servers.map((s) => s.id)).toContain("context7")
      expect(servers.map((s) => s.id)).toContain("grep_app")
    })
  })

  describe("getUserMcpInfo", () => {
    it("returns empty array when no user config", () => {
      // #given no user config exists
      // #when getting user info
      const servers = mcp.getUserMcpInfo()

      // #then should return array (may be empty)
      expect(Array.isArray(servers)).toBe(true)
    })
  })

  describe("checkBuiltinMcpServers", () => {
    it("returns pass with server count", async () => {
      // #given
      // #when checking builtin servers
      const result = await mcp.checkBuiltinMcpServers()

      // #then should pass
      expect(result.status).toBe("pass")
      expect(result.message).toContain("2")
      expect(result.message).toContain("enabled")
    })

    it("lists enabled servers in details", async () => {
      // #given
      // #when checking builtin servers
      const result = await mcp.checkBuiltinMcpServers()

      // #then should list servers
      expect(result.details?.some((d) => d.includes("context7"))).toBe(true)
      expect(result.details?.some((d) => d.includes("grep_app"))).toBe(true)
    })
  })

  describe("checkUserMcpServers", () => {
    let getUserSpy: ReturnType<typeof spyOn>

    afterEach(() => {
      getUserSpy?.mockRestore()
    })

    it("returns skip when no user config", async () => {
      // #given no user servers
      getUserSpy = spyOn(mcp, "getUserMcpInfo").mockReturnValue([])

      // #when checking
      const result = await mcp.checkUserMcpServers()

      // #then should skip
      expect(result.status).toBe("skip")
      expect(result.message).toContain("No user MCP")
    })

    it("returns pass when valid user servers", async () => {
      // #given valid user servers
      getUserSpy = spyOn(mcp, "getUserMcpInfo").mockReturnValue([
        { id: "custom-mcp", type: "user", enabled: true, valid: true },
      ])

      // #when checking
      const result = await mcp.checkUserMcpServers()

      // #then should pass
      expect(result.status).toBe("pass")
      expect(result.message).toContain("1")
    })

    it("returns warn when servers have issues", async () => {
      // #given invalid server config
      getUserSpy = spyOn(mcp, "getUserMcpInfo").mockReturnValue([
        { id: "bad-mcp", type: "user", enabled: true, valid: false, error: "Missing command" },
      ])

      // #when checking
      const result = await mcp.checkUserMcpServers()

      // #then should warn
      expect(result.status).toBe("warn")
      expect(result.details?.some((d) => d.includes("Invalid"))).toBe(true)
    })
  })

  describe("getMcpCheckDefinitions", () => {
    it("returns definitions for builtin and user", () => {
      // #given
      // #when getting definitions
      const defs = mcp.getMcpCheckDefinitions()

      // #then should have 2 definitions
      expect(defs.length).toBe(2)
      expect(defs.every((d) => d.category === "tools")).toBe(true)
      expect(defs.map((d) => d.id)).toContain("mcp-builtin")
      expect(defs.map((d) => d.id)).toContain("mcp-user")
    })
  })
})
