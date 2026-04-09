import { describe, it, expect } from "bun:test"
import { remapAgentKeysToDisplayNames } from "./agent-key-remapper"
import { getAgentDisplayName } from "../shared/agent-display-names"

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
    expect(result[getAgentDisplayName("sisyphus")]).toBeDefined()
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
      athena: {},
      metis: {},
      momus: {},
      "sisyphus-junior": {},
    }

    // when remapping
    const result = remapAgentKeysToDisplayNames(agents)

    // then all get display name keys
    expect(result[getAgentDisplayName("sisyphus")]).toBeDefined()
    expect(result["sisyphus"]).toBeUndefined()
    expect(result[getAgentDisplayName("hephaestus")]).toBeDefined()
    expect(result["hephaestus"]).toBeUndefined()
    expect(result[getAgentDisplayName("prometheus")]).toBeDefined()
    expect(result["prometheus"]).toBeUndefined()
    expect(result[getAgentDisplayName("atlas")]).toBeDefined()
    expect(result["atlas"]).toBeUndefined()
    expect(result[getAgentDisplayName("athena")]).toBeDefined()
    expect(result["athena"]).toBeUndefined()
    expect(result[getAgentDisplayName("metis")]).toBeDefined()
    expect(result["metis"]).toBeUndefined()
    expect(result[getAgentDisplayName("momus")]).toBeDefined()
    expect(result["momus"]).toBeUndefined()
    expect(result[getAgentDisplayName("sisyphus-junior")]).toBeDefined()
    expect(result["sisyphus-junior"]).toBeUndefined()
  })

  it("does not emit both config and display keys for remapped agents", () => {
    // given one remapped agent
    const agents = {
      sisyphus: { prompt: "test", mode: "primary" },
    }

    // when remapping
    const result = remapAgentKeysToDisplayNames(agents)

    // then only display key is emitted
    expect(Object.keys(result)).toEqual([getAgentDisplayName("sisyphus")])
    expect(result[getAgentDisplayName("sisyphus")]).toBeDefined()
    expect(result["sisyphus"]).toBeUndefined()
  })
})
