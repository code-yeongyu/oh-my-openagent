import { describe, it, expect } from "bun:test"
import { remapAgentKeysToDisplayNames } from "./agent-key-remapper"

describe("remapAgentKeysToDisplayNames", () => {
  it("remaps known agent keys to display names", () => {
    // given agents with lowercase keys
    const agents = {
      sisyphus: { prompt: "test", mode: "primary" },
      oracle: { prompt: "test", mode: "subagent" },
    }

    // when remapping
    const result = remapAgentKeysToDisplayNames(agents)

    // then known agents get display name keys only
    expect(result["Sisyphus (Ultraworker)"]).toBeDefined()
    expect(result["oracle"]).toBeDefined()
    expect(result["sisyphus"]).toBeUndefined()
  })

  it("preserves unknown agent keys unchanged", () => {
    // given agents with a custom key
    const agents = {
      "custom-agent": { prompt: "custom" },
    }

    // when remapping
    const result = remapAgentKeysToDisplayNames(agents)

    // then custom key is unchanged
    expect(result["custom-agent"]).toBeDefined()
  })

  it("remaps all core agents to display names", () => {
    // given all core agents
    const agents = {
      sisyphus: {},
      hephaestus: {},
      prometheus: {},
      atlas: {},
      metis: {},
      momus: {},
      "sisyphus-junior": {},
    }

    // when remapping
    const result = remapAgentKeysToDisplayNames(agents)

    // then all get display name keys without lowercase duplicates
    expect(result["Sisyphus (Ultraworker)"]).toBeDefined()
    expect(result["sisyphus"]).toBeUndefined()
    expect(result["Hephaestus (Deep Agent)"]).toBeDefined()
    expect(result["hephaestus"]).toBeUndefined()
    expect(result["Prometheus (Plan Builder)"]).toBeDefined()
    expect(result["prometheus"]).toBeUndefined()
    expect(result["Atlas (Plan Executor)"]).toBeDefined()
    expect(result["atlas"]).toBeUndefined()
    expect(result["Metis (Plan Consultant)"]).toBeDefined()
    expect(result["metis"]).toBeUndefined()
    expect(result["Momus (Plan Critic)"]).toBeDefined()
    expect(result["momus"]).toBeUndefined()
    expect(result["Sisyphus-Junior"]).toBeDefined()
    expect(result["sisyphus-junior"]).toBeUndefined()
  })
})
