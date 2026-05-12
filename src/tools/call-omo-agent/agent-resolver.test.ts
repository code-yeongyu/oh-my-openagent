const { describe, test, expect, mock, beforeEach } = require("bun:test")
const { resolveCallableAgents, clearCallableAgentsCache } = require("./agent-resolver")
const { ALLOWED_AGENTS } = require("./constants")

function createMockClient(agents: Array<Record<string, string>> = []) {
  return {
    app: {
      agents: mock(() => Promise.resolve({ data: agents })),
    },
  }
}

describe("resolveCallableAgents", () => {
  beforeEach(() => {
    clearCallableAgentsCache()
  })

  describe("#given call_omo_agent is restricted to lookup agents", () => {
    test("#then only ALLOWED_AGENTS are returned", async () => {
      const client = createMockClient()

      const result = await resolveCallableAgents(client)

      expect(result).toEqual([...ALLOWED_AGENTS])
    })

    test("#then runtime custom agents are ignored and not queried", async () => {
      const client = createMockClient([
        { name: "general", mode: "subagent" },
        { name: "bug-fixer", mode: "subagent" },
      ])

      const result = await resolveCallableAgents(client)

      expect(result).toEqual(["explore", "librarian"])
      expect(client.app.agents).not.toHaveBeenCalled()
    })

    test("#then non-lookup built-ins are not included", async () => {
      const client = createMockClient([
        { name: "oracle", mode: "subagent" },
        { name: "hephaestus", mode: "subagent" },
        { name: "metis", mode: "subagent" },
      ])

      const result = await resolveCallableAgents(client)

      expect(result).not.toContain("oracle")
      expect(result).not.toContain("hephaestus")
      expect(result).not.toContain("metis")
    })

    test("#then each call returns a defensive copy", async () => {
      const client = createMockClient()

      const first = await resolveCallableAgents(client)
      first.push("general")
      const second = await resolveCallableAgents(client)

      expect(second).toEqual(["explore", "librarian"])
    })
  })
})

export {}
