import { describe, it, expect } from "bun:test"
import { remapAgentKeysToDisplayNames } from "./agent-key-remapper"
import { getAgentDisplayName, getAgentRuntimeName } from "../shared/agent-display-names"

const ZWSP_REGEX = /[\u200B\u200C\u200D\uFEFF]/

describe("remapAgentKeysToDisplayNames", () => {
  it("object keys must not contain ZWSP characters (RFC 7230)", () => {
    // given all core agents with ZWSP-based ordering
    const agents = {
      sisyphus: { prompt: "test" },
      hephaestus: { prompt: "test" },
      prometheus: { prompt: "test" },
      atlas: { prompt: "test" },
    }

    // when remapping
    const result = remapAgentKeysToDisplayNames(agents)

    // then NO object key should contain ZWSP (RFC 7230 compliance)
    for (const key of Object.keys(result)) {
      expect(key).not.toMatch(ZWSP_REGEX)
    }
  })

  it("name field MUST contain ZWSP for core agents (OpenCode sort ordering)", () => {
    // given core agents
    const agents = {
      sisyphus: { prompt: "test" },
      hephaestus: { prompt: "test" },
      prometheus: { prompt: "test" },
      atlas: { prompt: "test" },
    }

    // when remapping
    const result = remapAgentKeysToDisplayNames(agents)

    // then name fields MUST have ZWSP prefixes for sort ordering
    const sisyphusConfig = result[getAgentDisplayName("sisyphus")] as Record<string, unknown>
    const hephaestusConfig = result[getAgentDisplayName("hephaestus")] as Record<string, unknown>
    const prometheusConfig = result[getAgentDisplayName("prometheus")] as Record<string, unknown>
    const atlasConfig = result[getAgentDisplayName("atlas")] as Record<string, unknown>

    expect(sisyphusConfig.name).toMatch(ZWSP_REGEX)
    expect(hephaestusConfig.name).toMatch(ZWSP_REGEX)
    expect(prometheusConfig.name).toMatch(ZWSP_REGEX)
    expect(atlasConfig.name).toMatch(ZWSP_REGEX)

    // And they should be the runtime names (with ZWSP)
    expect(sisyphusConfig.name).toBe(getAgentRuntimeName("sisyphus"))
    expect(hephaestusConfig.name).toBe(getAgentRuntimeName("hephaestus"))
    expect(prometheusConfig.name).toBe(getAgentRuntimeName("prometheus"))
    expect(atlasConfig.name).toBe(getAgentRuntimeName("atlas"))
  })


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

  it("returns runtime core agent list names in canonical order", () => {
    // given
    const result = remapAgentKeysToDisplayNames({
      atlas: {},
      prometheus: {},
      hephaestus: {},
      sisyphus: {},
    })

    // when
    const remappedNames = Object.keys(result)

    // then
    expect(remappedNames).toEqual([
      getAgentDisplayName("atlas"),
      getAgentDisplayName("prometheus"),
      getAgentDisplayName("hephaestus"),
      getAgentDisplayName("sisyphus"),
    ])
  })

  it("keeps remapped core agent name fields aligned with OpenCode list ordering", () => {
    // given agents with raw config-key names
    const agents = {
      sisyphus: { name: "sisyphus", prompt: "test", mode: "primary" },
      hephaestus: { name: "hephaestus", prompt: "test", mode: "primary" },
      prometheus: { name: "prometheus", prompt: "test", mode: "all" },
      atlas: { name: "atlas", prompt: "test", mode: "primary" },
      oracle: { name: "oracle", prompt: "test", mode: "subagent" },
    }

    // when remapping
    const result = remapAgentKeysToDisplayNames(agents)

    // then keys and names both use the same runtime-facing list names
    expect(Object.keys(result).slice(0, 4)).toEqual([
      getAgentDisplayName("sisyphus"),
      getAgentDisplayName("hephaestus"),
      getAgentDisplayName("prometheus"),
      getAgentDisplayName("atlas"),
    ])
    expect(result[getAgentDisplayName("sisyphus")]).toEqual({
      name: getAgentRuntimeName("sisyphus"),
      prompt: "test",
      mode: "primary",
    })
    expect(result[getAgentDisplayName("hephaestus")]).toEqual({
      name: getAgentRuntimeName("hephaestus"),
      prompt: "test",
      mode: "primary",
    })
    expect(result[getAgentDisplayName("prometheus")]).toEqual({
      name: getAgentRuntimeName("prometheus"),
      prompt: "test",
      mode: "all",
    })
    expect(result[getAgentDisplayName("atlas")]).toEqual({
      name: getAgentRuntimeName("atlas"),
      prompt: "test",
      mode: "primary",
    })
    expect(result.oracle).toEqual({ name: "oracle", prompt: "test", mode: "subagent" })
  })

  it("backfills runtime names for core agents when builtin configs omit name", () => {
    // given builtin-style configs without name fields
    const agents = {
      sisyphus: { prompt: "test", mode: "primary" },
      hephaestus: { prompt: "test", mode: "primary" },
      prometheus: { prompt: "test", mode: "all" },
      atlas: { prompt: "test", mode: "primary" },
    }

    // when remapping
    const result = remapAgentKeysToDisplayNames(agents)

    // then runtime-facing names stay aligned even when builtin configs omit name
    expect(result[getAgentDisplayName("sisyphus")]).toEqual({
      name: getAgentRuntimeName("sisyphus"),
      prompt: "test",
      mode: "primary",
    })
    expect(result[getAgentDisplayName("hephaestus")]).toEqual({
      name: getAgentRuntimeName("hephaestus"),
      prompt: "test",
      mode: "primary",
    })
    expect(result[getAgentDisplayName("prometheus")]).toEqual({
      name: getAgentRuntimeName("prometheus"),
      prompt: "test",
      mode: "all",
    })
    expect(result[getAgentDisplayName("atlas")]).toEqual({
      name: getAgentRuntimeName("atlas"),
      prompt: "test",
      mode: "primary",
    })
  })
})
