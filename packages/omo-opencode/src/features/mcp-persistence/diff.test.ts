import { describe, expect, test } from "bun:test"
import { diffMcpStates, type McpStateMap } from "./diff"

function mkMap(entries: Record<string, "enabled" | "disabled">): McpStateMap {
  return new Map(Object.entries(entries))
}

describe("diffMcpStates", () => {
  describe("#given identical runtime and persisted states", () => {
    test("#when diffed #then returns empty array", () => {
      const runtime = mkMap({ github: "enabled", slack: "disabled" })
      const persisted = mkMap({ github: "enabled", slack: "disabled" })
      expect(diffMcpStates(runtime, persisted)).toEqual([])
    })
  })

  describe("#given a runtime toggle off vs persisted enabled", () => {
    test("#when diffed #then returns one entry from=enabled to=disabled", () => {
      const runtime = mkMap({ github: "disabled" })
      const persisted = mkMap({ github: "enabled" })
      expect(diffMcpStates(runtime, persisted)).toEqual([
        { name: "github", from: "enabled", to: "disabled" },
      ])
    })
  })

  describe("#given a runtime toggle on vs persisted disabled", () => {
    test("#when diffed #then returns one entry from=disabled to=enabled", () => {
      const runtime = mkMap({ github: "enabled" })
      const persisted = mkMap({ github: "disabled" })
      expect(diffMcpStates(runtime, persisted)).toEqual([
        { name: "github", from: "disabled", to: "enabled" },
      ])
    })
  })

  describe("#given runtime MCP not in persisted map", () => {
    test("#when diffed #then returns entry with from=unknown", () => {
      const runtime = mkMap({ newmcp: "disabled" })
      const persisted = mkMap({})
      expect(diffMcpStates(runtime, persisted)).toEqual([
        { name: "newmcp", from: "unknown", to: "disabled" },
      ])
    })
  })

  describe("#given multiple MCP changes", () => {
    test("#when diffed #then returns all changed entries", () => {
      const runtime = mkMap({ a: "disabled", b: "enabled", c: "enabled" })
      const persisted = mkMap({ a: "enabled", b: "disabled", c: "enabled" })
      const changes = diffMcpStates(runtime, persisted).sort((x, y) =>
        x.name.localeCompare(y.name),
      )
      expect(changes).toEqual([
        { name: "a", from: "enabled", to: "disabled" },
        { name: "b", from: "disabled", to: "enabled" },
      ])
    })
  })

  describe("#given persisted entries absent from runtime", () => {
    test("#when diffed #then they are ignored (no destructive ops)", () => {
      const runtime = mkMap({ a: "enabled" })
      const persisted = mkMap({ a: "enabled", b: "disabled" })
      expect(diffMcpStates(runtime, persisted)).toEqual([])
    })
  })
})
