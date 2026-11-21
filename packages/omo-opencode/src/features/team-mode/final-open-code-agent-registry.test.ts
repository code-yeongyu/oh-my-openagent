import { describe, expect, test } from "bun:test"
import { hasProjectAgentProvenance, replaceProjectAgentProvenance, resolveFinalProjectAgent } from "./final-open-code-agent-registry"

function finalAgent(overrides: Record<string, unknown> = {}) {
  return {
    name: "project-worker", mode: "subagent", native: false, hidden: null,
    model: { providerID: "qa", modelID: "exact" }, variant: "high",
    permission: [{ permission: "*", pattern: "*", action: "allow" }],
    ...overrides,
  }
}

describe("nearest project provenance snapshot", () => {
  test.each([
    { nearer: undefined, suffix: "/nested/member", expected: true },
    { nearer: [], suffix: "/nested/member", expected: false },
    { nearer: ["other-worker"], suffix: "/nested/member", expected: false },
    { nearer: undefined, suffix: "-sibling/member", expected: false },
  ])("uses the nearest lexical snapshot: %j", ({ nearer, suffix, expected }) => {
    const directory = `/tmp/provenance-${crypto.randomUUID()}`
    replaceProjectAgentProvenance(directory, ["project-worker"])
    if (nearer !== undefined) replaceProjectAgentProvenance(`${directory}/nested`, nearer)
    expect(hasProjectAgentProvenance(`${directory}${suffix}`, "project-worker")).toBe(expected)
  })

  test.each(["constructor", "__proto__", "toString"])("never admits prototype name %s", async (name) => {
    const directory = `/tmp/provenance-${crypto.randomUUID()}`
    replaceProjectAgentProvenance(directory, [name])
    const client = { app: { agents: async () => [finalAgent({ name })] } }
    await expect(resolveFinalProjectAgent(client, directory, name)).rejects.toThrow("no config-time provenance")
  })
})

describe("final OpenCode registry admission", () => {
  test.each([
    { mode: "subagent" }, { mode: "all" },
    { model: null, variant: null, hidden: null },
    { permission: [{ permission: "*", pattern: "*", action: "allow" }, { permission: "task", pattern: "*", action: "deny" }] },
  ])("keeps exact nullable model and variant, permitting safe launch narrowing: %j", async (overrides) => {
    const directory = `/tmp/provenance-${crypto.randomUUID()}`
    replaceProjectAgentProvenance(directory, ["project-worker"])
    const agent = finalAgent(overrides)
    const client = { app: { agents: async () => ({ data: [agent] }) } }
    const result = await resolveFinalProjectAgent(client, directory, "project-worker")
    expect(result).toEqual({ name: "project-worker", model: agent.model === null ? undefined : { providerID: "qa", modelID: "exact", variant: "high" } })
  })

  test.each([
    { name: "Project-worker" }, { native: true }, { hidden: true }, { mode: "primary" },
    { permission: [] },
    { permission: [{ permission: "*", pattern: "*", action: "allow" }, { permission: "team_task_*", pattern: "*", action: "deny" }] },
    { permission: [{ permission: "*", pattern: "*", action: "allow" }, { permission: "team_status", pattern: "restricted", action: "ask" }] },
    { permission: [{ permission: "*", pattern: "*", action: "allow" }, { permission: "call_omo_agent", pattern: "*", action: "deny" }] },
    { permission: [{ permission: "*", pattern: "*", action: "allow" }, { permission: "question", pattern: "*", action: "ask" }] },
  ])("rejects an incompatible final entry: %j", async (overrides) => {
    const directory = `/tmp/provenance-${crypto.randomUUID()}`
    replaceProjectAgentProvenance(directory, ["project-worker"])
    const client = { app: { agents: async () => [finalAgent(overrides)] } }
    await expect(resolveFinalProjectAgent(client, directory, "project-worker")).rejects.toThrow()
  })

  test("does not grant global registry entries provenance", async () => {
    const directory = `/tmp/provenance-${crypto.randomUUID()}`
    const client = { app: { agents: async () => [finalAgent()] } }
    await expect(resolveFinalProjectAgent(client, directory, "project-worker")).rejects.toThrow("no config-time provenance")
  })
})
