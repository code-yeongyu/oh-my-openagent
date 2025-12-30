import { describe, it, expect, spyOn, afterEach } from "bun:test"
import * as lsp from "./lsp"
import type { LspServerInfo } from "../types"

describe("lsp check", () => {
  describe("getLspServersInfo", () => {
    it("returns array of server info", async () => {
      // #given
      // #when getting servers info
      const servers = await lsp.getLspServersInfo()

      // #then should return array with expected structure
      expect(Array.isArray(servers)).toBe(true)
      servers.forEach((s) => {
        expect(s.id).toBeDefined()
        expect(typeof s.installed).toBe("boolean")
        expect(Array.isArray(s.extensions)).toBe(true)
      })
    })
  })

  describe("getLspServerStats", () => {
    it("counts installed servers correctly", () => {
      // #given servers with mixed installation status
      const servers = [
        { id: "ts", installed: true, extensions: [".ts"], source: "builtin" as const },
        { id: "py", installed: false, extensions: [".py"], source: "builtin" as const },
        { id: "go", installed: true, extensions: [".go"], source: "builtin" as const },
      ]

      // #when getting stats
      const stats = lsp.getLspServerStats(servers)

      // #then should count correctly
      expect(stats.installed).toBe(2)
      expect(stats.total).toBe(3)
    })

    it("handles empty array", () => {
      // #given no servers
      const servers: LspServerInfo[] = []

      // #when getting stats
      const stats = lsp.getLspServerStats(servers)

      // #then should return zeros
      expect(stats.installed).toBe(0)
      expect(stats.total).toBe(0)
    })
  })

  describe("checkLspServers", () => {
    let getServersSpy: ReturnType<typeof spyOn>

    afterEach(() => {
      getServersSpy?.mockRestore()
    })

    it("returns warn when no servers installed", async () => {
      // #given no servers installed
      getServersSpy = spyOn(lsp, "getLspServersInfo").mockResolvedValue([
        { id: "typescript-language-server", installed: false, extensions: [".ts"], source: "builtin" },
        { id: "pyright", installed: false, extensions: [".py"], source: "builtin" },
      ])

      // #when checking
      const result = await lsp.checkLspServers()

      // #then should warn
      expect(result.status).toBe("warn")
      expect(result.message).toContain("No LSP servers")
    })

    it("returns pass when servers installed", async () => {
      // #given some servers installed
      getServersSpy = spyOn(lsp, "getLspServersInfo").mockResolvedValue([
        { id: "typescript-language-server", installed: true, extensions: [".ts"], source: "builtin" },
        { id: "pyright", installed: false, extensions: [".py"], source: "builtin" },
      ])

      // #when checking
      const result = await lsp.checkLspServers()

      // #then should pass with count
      expect(result.status).toBe("pass")
      expect(result.message).toContain("1/2")
    })

    it("lists installed and missing servers in details", async () => {
      // #given mixed installation
      getServersSpy = spyOn(lsp, "getLspServersInfo").mockResolvedValue([
        { id: "typescript-language-server", installed: true, extensions: [".ts"], source: "builtin" },
        { id: "pyright", installed: false, extensions: [".py"], source: "builtin" },
      ])

      // #when checking
      const result = await lsp.checkLspServers()

      // #then should list both
      expect(result.details?.some((d) => d.includes("Installed"))).toBe(true)
      expect(result.details?.some((d) => d.includes("Not found"))).toBe(true)
    })
  })

  describe("getLspCheckDefinition", () => {
    it("returns valid check definition", () => {
      // #given
      // #when getting definition
      const def = lsp.getLspCheckDefinition()

      // #then should have required properties
      expect(def.id).toBe("lsp-servers")
      expect(def.category).toBe("tools")
      expect(def.critical).toBe(false)
    })
  })
})
