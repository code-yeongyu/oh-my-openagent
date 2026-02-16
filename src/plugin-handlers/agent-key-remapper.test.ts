import { describe, it, expect } from "bun:test"
import { remapAgentKeysToDisplayNames } from "./agent-key-remapper"

describe("remapAgentKeysToDisplayNames", () => {
  it("remaps known agent keys to display names", () => {
    // given agents with lowercase keys
    const agents = {
      morpheus: { prompt: "test", mode: "primary" },
      oracle: { prompt: "test", mode: "subagent" },
    }

    // when remapping
    const result = remapAgentKeysToDisplayNames(agents)

    // then known agents get display name keys
    expect(result["Morpheus (Ultraworker)"]).toBeDefined()
    expect(result["Oracle (Plan Builder)"]).toBeDefined()
    expect(result["morpheus"]).toBeUndefined()
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

  it("remaps all core agents", () => {
    // given all core agents
    const agents = {
      morpheus: {},
      keymaker: {},
      oracle: {},
      architect: {},
      seraph: {},
      smith: {},
      mouse: {},
    }

    // when remapping
    const result = remapAgentKeysToDisplayNames(agents)

    // then all get display name keys
    expect(Object.keys(result)).toEqual([
      "Morpheus (Ultraworker)",
      "Keymaker (Deep Agent)",
      "Oracle (Plan Builder)",
      "Architect (Plan Execution Orchestrator)",
      "Seraph (Plan Consultant)",
      "Smith (Plan Reviewer)",
      "Mouse",
    ])
  })
})
