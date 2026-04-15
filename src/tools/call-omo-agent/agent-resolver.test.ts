/**
 * Requirement-based tests for resolveCallableAgents().
 *
 * These tests are derived from behavioral requirements in the PR description
 * and feature spec, NOT from reading the implementation:
 *
 * R1: ALLOWED_AGENTS always present as baseline
 * R2: Dynamic agents from client.app.agents() merged into the result
 * R3: Primary-mode agents excluded from callable list
 * R4: Falls back to ALLOWED_AGENTS alone when client.app.agents() fails
 * R5: All output names are lowercase
 * R6: No duplicate agent names in output
 * R7: Malformed agent entries (null, missing name, non-string name, whitespace-only) are skipped gracefully
 */
const { describe, test, expect, mock, beforeEach } = require("bun:test")
const { resolveCallableAgents, clearCallableAgentsCache } = require("./agent-resolver")
const { ALLOWED_AGENTS } = require("./constants")

function createMockClient(agents: Array<Record<string, unknown>>) {
  return {
    app: {
      agents: mock(() => Promise.resolve({ data: agents })),
    },
  }
}

function createFailingClient(error: Error = new Error("API unavailable")) {
  return {
    app: {
      agents: mock(() => Promise.reject(error)),
    },
  }
}

describe("resolveCallableAgents", () => {
  beforeEach(() => {
    clearCallableAgentsCache()
  })

  describe("#given the SDK returns agents successfully", () => {
    describe("#when only built-in agents exist", () => {
      test("#then every ALLOWED_AGENT appears in the result", async () => {
        const builtinAgents = ALLOWED_AGENTS.map((name: string) => ({
          name,
          mode: "subagent",
        }))
        const client = createMockClient(builtinAgents)

        const result = await resolveCallableAgents(client)

        for (const agent of ALLOWED_AGENTS) {
          expect(result).toContain(agent)
        }
      })
    })

    describe("#when dynamic custom agents are present alongside built-ins", () => {
      test("#then custom agents are included in the result", async () => {
        const agents = [
          ...ALLOWED_AGENTS.map((name: string) => ({ name, mode: "subagent" })),
          { name: "bug-fixer", mode: "subagent" },
          { name: "code-reviewer", mode: "subagent" },
        ]
        const client = createMockClient(agents)

        const result = await resolveCallableAgents(client)

        expect(result).toContain("bug-fixer")
        expect(result).toContain("code-reviewer")
      })

      test("#then ALLOWED_AGENTS are still present", async () => {
        const agents = [{ name: "custom-agent", mode: "subagent" }]
        const client = createMockClient(agents)

        const result = await resolveCallableAgents(client)

        for (const agent of ALLOWED_AGENTS) {
          expect(result).toContain(agent)
        }
      })
    })

    describe("#when an agent has mode=primary", () => {
      test("#then it is excluded from the callable list", async () => {
        const agents = [
          { name: "sisyphus", mode: "primary" },
          { name: "explore", mode: "subagent" },
        ]
        const client = createMockClient(agents)

        const result = await resolveCallableAgents(client)

        expect(result).not.toContain("sisyphus")
        expect(result).toContain("explore")
      })
    })

    describe("#when agent names have mixed case", () => {
      test("#then all output names are lowercase", async () => {
        const agents = [
          { name: "Bug-Fixer", mode: "subagent" },
          { name: "CODE-REVIEWER", mode: "subagent" },
        ]
        const client = createMockClient(agents)

        const result = await resolveCallableAgents(client)

        expect(result).toContain("bug-fixer")
        expect(result).toContain("code-reviewer")
        for (const name of result) {
          expect(name).toBe(name.toLowerCase())
        }
      })
    })

    describe("#when duplicate agent names exist across sources", () => {
      test("#then no duplicates appear in the result", async () => {
        const agents = [
          { name: "explore", mode: "subagent" },
          { name: "explore", mode: "subagent" },
          { name: "Explore", mode: "subagent" },
        ]
        const client = createMockClient(agents)

        const result = await resolveCallableAgents(client)

        const exploreCount = result.filter((n: string) => n === "explore").length
        expect(exploreCount).toBe(1)
      })
    })

    describe("#when agent entries are malformed", () => {
      test("#then entries with null name are skipped", async () => {
        const agents = [
          { name: null, mode: "subagent" },
          { name: "explore", mode: "subagent" },
        ]
        const client = createMockClient(agents)

        const result = await resolveCallableAgents(client)

        expect(result).toContain("explore")
        expect(result.length).toBeGreaterThanOrEqual(ALLOWED_AGENTS.length)
      })

      test("#then entries with numeric name are skipped", async () => {
        const agents = [
          { name: 42, mode: "subagent" },
          { name: "explore", mode: "subagent" },
        ]
        const client = createMockClient(agents)

        const result = await resolveCallableAgents(client)

        expect(result).not.toContain("42")
        expect(result).toContain("explore")
      })

      test("#then entries with whitespace-only name are skipped", async () => {
        const agents = [
          { name: "   ", mode: "subagent" },
          { name: "explore", mode: "subagent" },
        ]
        const client = createMockClient(agents)

        const result = await resolveCallableAgents(client)

        expect(result).not.toContain("")
        expect(result).not.toContain("   ")
        expect(result).toContain("explore")
      })

      test("#then entries with missing name property are skipped", async () => {
        const agents = [
          { mode: "subagent" },
          { name: "explore", mode: "subagent" },
        ]
        const client = createMockClient(agents)

        const result = await resolveCallableAgents(client)

        expect(result).toContain("explore")
        expect(result.length).toBeGreaterThanOrEqual(ALLOWED_AGENTS.length)
      })

      test("#then entries that are undefined/null themselves are skipped", async () => {
        const agents = [
          null,
          undefined,
          { name: "explore", mode: "subagent" },
        ] as unknown as Array<Record<string, unknown>>
        const client = createMockClient(agents)

        const result = await resolveCallableAgents(client)

        expect(result).toContain("explore")
      })
    })

    describe("#when SDK returns an empty list", () => {
      test("#then ALLOWED_AGENTS still appear as the baseline", async () => {
        const client = createMockClient([])

        const result = await resolveCallableAgents(client)

        for (const agent of ALLOWED_AGENTS) {
          expect(result).toContain(agent)
        }
        expect(result.length).toBe(ALLOWED_AGENTS.length)
      })
    })
  })

  describe("#given the SDK call fails", () => {
    describe("#when client.app.agents() throws an error", () => {
      test("#then it falls back to ALLOWED_AGENTS", async () => {
        const client = createFailingClient(new Error("Network error"))

        const result = await resolveCallableAgents(client)

        expect(result.length).toBe(ALLOWED_AGENTS.length)
        for (const agent of ALLOWED_AGENTS) {
          expect(result).toContain(agent)
        }
      })

      test("#then custom agents are NOT available in fallback mode", async () => {
        const client = createFailingClient()

        const result = await resolveCallableAgents(client)

        expect(result).not.toContain("bug-fixer")
        expect(result).not.toContain("custom-agent")
      })
    })
  })
})

export {}
