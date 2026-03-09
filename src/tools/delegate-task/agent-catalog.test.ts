declare const require: (name: string) => any
const { describe, test, expect } = require("bun:test")
import { getTaskAgentCatalog, matchAgentByName, matchPrimaryAgentByName, type TaskAgentCatalog } from "./agent-catalog"
import type { OpencodeClient } from "./types"

function createMockClient(agentsFn: () => Promise<unknown>): OpencodeClient {
  return {
    app: {
      agents: agentsFn,
    },
  } as OpencodeClient
}

function createCatalog(agents: Array<{ name: string; mode?: string }>): TaskAgentCatalog {
  const all = agents.map((a) => ({ ...a, mode: (a.mode as "subagent" | "primary" | "all") || "subagent" }))
  return {
    all,
    callable: all.filter((a) => a.mode !== "primary"),
    primary: all.filter((a) => a.mode === "primary" || a.mode === "all"),
  }
}

describe("getTaskAgentCatalog", () => {
  test("returns null when client.app.agents() throws", async () => {
    //#given
    const client = createMockClient(async () => {
      throw new Error("API unavailable")
    })

    //#when
    const result = await getTaskAgentCatalog(client)

    //#then
    expect(result).toBeNull()
  })

  test("returns null when client.app.agents() returns empty", async () => {
    //#given
    const client = createMockClient(async () => ({ data: [] }))

    //#when
    const result = await getTaskAgentCatalog(client)

    //#then
    expect(result).toBeNull()
  })

  test("buckets agents into callable and primary correctly", async () => {
    //#given
    const mockAgents = [
      { name: "sisyphus", mode: "primary" },
      { name: "explore", mode: "subagent" },
      { name: "oracle", mode: "subagent" },
      { name: "prometheus", mode: "primary" },
      { name: "librarian", mode: "all" },
    ]
    const client = createMockClient(async () => ({ data: mockAgents }))

    //#when
    const result = await getTaskAgentCatalog(client)

    //#then
    expect(result).not.toBeNull()
    expect(result!.all).toHaveLength(5)
    expect(result!.callable).toHaveLength(3) // explore, oracle, librarian
    expect(result!.primary).toHaveLength(3) // sisyphus, prometheus, librarian

    const callableNames = result!.callable.map((a) => a.name)
    expect(callableNames).toContain("explore")
    expect(callableNames).toContain("oracle")
    expect(callableNames).toContain("librarian")

    const primaryNames = result!.primary.map((a) => a.name)
    expect(primaryNames).toContain("sisyphus")
    expect(primaryNames).toContain("prometheus")
    expect(primaryNames).toContain("librarian")
  })

  test("callable excludes mode=primary agents", async () => {
    //#given
    const mockAgents = [
      { name: "sisyphus", mode: "primary" },
      { name: "explore", mode: "subagent" },
    ]
    const client = createMockClient(async () => ({ data: mockAgents }))

    //#when
    const result = await getTaskAgentCatalog(client)

    //#then
    expect(result).not.toBeNull()
    expect(result!.callable.every((a) => a.mode !== "primary")).toBe(true)
    expect(result!.callable.map((a) => a.name)).not.toContain("sisyphus")
  })

  test("includes mode:'all' agents in both callable and primary buckets", async () => {
    //#given
    const mockAgents = [
      { name: "sisyphus", mode: "primary" },
      { name: "explore", mode: "subagent" },
      { name: "librarian", mode: "all" },
    ]
    const client = createMockClient(async () => ({ data: mockAgents }))

    //#when
    const result = await getTaskAgentCatalog(client)

    //#then
    expect(result).not.toBeNull()
    expect(result!.callable).toContainEqual(expect.objectContaining({ name: "librarian" }))
    expect(result!.primary).toContainEqual(expect.objectContaining({ name: "librarian" }))
  })
})

describe("matchAgentByName", () => {
  test("returns null for empty name", () => {
    //#given
    const catalog = createCatalog([{ name: "explore" }])

    //#when
    const result = matchAgentByName("", catalog)

    //#then
    expect(result).toBeNull()
  })

  test("returns null for whitespace-only name", () => {
    //#given
    const catalog = createCatalog([{ name: "explore" }])

    //#when
    const result = matchAgentByName("   ", catalog)

    //#then
    expect(result).toBeNull()
  })

  test("returns null when agent not found", () => {
    //#given
    const catalog = createCatalog([{ name: "explore" }, { name: "oracle" }])

    //#when
    const result = matchAgentByName("nonexistent", catalog)

    //#then
    expect(result).toBeNull()
  })

  test("matches agent by exact name", () => {
    //#given
    const catalog = createCatalog([{ name: "explore" }, { name: "oracle" }])

    //#when
    const result = matchAgentByName("oracle", catalog)

    //#then
    expect(result).not.toBeNull()
    expect(result!.canonicalName).toBe("oracle")
    expect(result!.agent.name).toBe("oracle")
  })

  test("matches agent case-insensitively", () => {
    //#given
    const catalog = createCatalog([{ name: "Oracle" }, { name: "explore" }])

    //#when
    const result = matchAgentByName("oracle", catalog)

    //#then
    expect(result).not.toBeNull()
    expect(result!.canonicalName).toBe("Oracle")
  })

  test("trims whitespace from input name", () => {
    //#given
    const catalog = createCatalog([{ name: "explore" }])

    //#when
    const result = matchAgentByName("  explore  ", catalog)

    //#then
    expect(result).not.toBeNull()
    expect(result!.canonicalName).toBe("explore")
  })

  test("does not match primary agents", () => {
    //#given
    const catalog = createCatalog([
      { name: "sisyphus", mode: "primary" },
      { name: "explore", mode: "subagent" },
    ])

    //#when
    const result = matchAgentByName("sisyphus", catalog)

    //#then
    expect(result).toBeNull()
  })

  test("resolves display name to canonical agent name", () => {
    //#given
    const catalog = createCatalog([{ name: "hephaestus" }])

    //#when
    const result = matchAgentByName("Hephaestus (Deep Agent)", catalog)

    //#then
    expect(result).not.toBeNull()
    expect(result!.canonicalName).toBe("hephaestus")
  })

  test("matches display-name catalog entry by config key input", () => {
    //#given
    const catalog = createCatalog([
      { name: "Hephaestus (Deep Agent)" },
      { name: "explore" },
    ])

    //#when
    const result = matchAgentByName("hephaestus", catalog)

    //#then
    expect(result).not.toBeNull()
    expect(result!.canonicalName).toBe("Hephaestus (Deep Agent)")
    expect(result!.agent.name).toBe("Hephaestus (Deep Agent)")
  })
})

describe("matchPrimaryAgentByName", () => {
  test("matches primary agent by name", () => {
    //#given
    const catalog = createCatalog([
      { name: "sisyphus", mode: "primary" },
      { name: "explore", mode: "subagent" },
    ])

    //#when
    const result = matchPrimaryAgentByName("sisyphus", catalog)

    //#then
    expect(result).not.toBeNull()
    expect(result!.canonicalName).toBe("sisyphus")
  })

  test("returns null for callable agents", () => {
    //#given
    const catalog = createCatalog([
      { name: "sisyphus", mode: "primary" },
      { name: "explore", mode: "subagent" },
    ])

    //#when
    const result = matchPrimaryAgentByName("explore", catalog)

    //#then
    expect(result).toBeNull()
  })

  test("matches case-insensitively", () => {
    //#given
    const catalog = createCatalog([{ name: "Prometheus", mode: "primary" }])

    //#when
    const result = matchPrimaryAgentByName("prometheus", catalog)

    //#then
    expect(result).not.toBeNull()
    expect(result!.canonicalName).toBe("Prometheus")
  })

  test("resolves display name to canonical primary agent name", () => {
    //#given
    const catalog = createCatalog([{ name: "sisyphus", mode: "primary" }])

    //#when
    const result = matchPrimaryAgentByName("Sisyphus (Ultraworker)", catalog)

    //#then
    expect(result).not.toBeNull()
    expect(result!.canonicalName).toBe("sisyphus")
  })

  test("matches display-name catalog entry by config key input", () => {
    //#given
    const catalog = createCatalog([
      { name: "Sisyphus (Ultraworker)", mode: "primary" },
      { name: "explore" },
    ])

    //#when
    const result = matchPrimaryAgentByName("sisyphus", catalog)

    //#then
    expect(result).not.toBeNull()
    expect(result!.canonicalName).toBe("Sisyphus (Ultraworker)")
  })
})
