import { describe, it, expect } from "bun:test"
import { remapAgentKeysToDisplayNames } from "./agent-key-remapper"

describe("remapAgentKeysToDisplayNames", () => {
  it("remaps known agent keys to display names while preserving original keys", () => {
    // given agents with lowercase keys
    const agents = {
      sisyphus: { prompt: "test", mode: "primary" },
      oracle: { prompt: "test", mode: "subagent" },
    }

    // when remapping
    const result = remapAgentKeysToDisplayNames(agents)

    // then known agents get display name keys and original keys remain accessible
    expect(result["Sisyphus (Ultraworker)"]).toBeDefined()
    expect(result["oracle"]).toBeDefined()
    expect(result["sisyphus"]).toBeDefined()
    expect(result["Sisyphus (Ultraworker)"]).toBe(result["sisyphus"])
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

  it("remaps all core agents while preserving original keys", () => {
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

    // then all get display name keys while original keys still work
    expect(result["Sisyphus (Ultraworker)"]).toBeDefined()
    expect(result["sisyphus"]).toBeDefined()
    expect(result["Hephaestus (Deep Agent)"]).toBeDefined()
    expect(result["hephaestus"]).toBeDefined()
    expect(result["Prometheus (Plan Builder)"]).toBeDefined()
    expect(result["prometheus"]).toBeDefined()
    expect(result["Atlas (Plan Executor)"]).toBeDefined()
    expect(result["atlas"]).toBeDefined()
    expect(result["Metis (Plan Consultant)"]).toBeDefined()
    expect(result["metis"]).toBeDefined()
    expect(result["Momus (Plan Critic)"]).toBeDefined()
    expect(result["momus"]).toBeDefined()
    expect(result["Sisyphus-Junior"]).toBeDefined()
    expect(result["sisyphus-junior"]).toBeDefined()
  })
})
