import { describe, it, expect } from "bun:test"
import { remapAgentKeysToDisplayNames } from "./agent-key-remapper"
import { getAgentDisplayName, getAgentListDisplayName } from "../shared/agent-display-names"

describe("remapAgentKeysToDisplayNames", () => {
  it("remaps known agent keys to display names", () => {
    // given agents with lowercase keys
    const agents = {
      sisyphus: { prompt: "test", mode: "primary" },
      oracle: { prompt: "test", mode: "subagent" },
    }

    // when remapping
    const result = remapAgentKeysToDisplayNames(agents)

    // then known agents get display name keys plus hidden config-key aliases
    expect(result[getAgentListDisplayName("sisyphus")]).toBeDefined()
    expect(result["oracle"]).toBeDefined()
    expect(result["sisyphus"]).toMatchObject({ hidden: true })
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
    expect(result[getAgentListDisplayName("sisyphus")]).toBeDefined()
    expect(result["sisyphus"]).toMatchObject({ hidden: true })
    expect(result[getAgentListDisplayName("hephaestus")]).toBeDefined()
    expect(result["hephaestus"]).toMatchObject({ hidden: true })
    expect(result[getAgentListDisplayName("prometheus")]).toBeDefined()
    expect(result["prometheus"]).toMatchObject({ hidden: true })
    expect(result[getAgentListDisplayName("atlas")]).toBeDefined()
    expect(result["atlas"]).toMatchObject({ hidden: true })
    expect(result[getAgentDisplayName("athena")]).toBeDefined()
    expect(result["athena"]).toMatchObject({ hidden: true })
    expect(result[getAgentDisplayName("metis")]).toBeDefined()
    expect(result["metis"]).toMatchObject({ hidden: true })
    expect(result[getAgentDisplayName("momus")]).toBeDefined()
    expect(result["momus"]).toMatchObject({ hidden: true })
    expect(result[getAgentDisplayName("sisyphus-junior")]).toBeDefined()
    expect(result["sisyphus-junior"]).toMatchObject({ hidden: true })
  })

  it("emits config-key aliases as hidden so CLI lookup works without a second TUI row", () => {
    // given one remapped agent
    const agents = {
      sisyphus: { prompt: "test", mode: "primary" },
    }

    // when remapping
    const result = remapAgentKeysToDisplayNames(agents)

    // then display key is visible and config key is a hidden alias
    const display = getAgentListDisplayName("sisyphus")
    expect(result[display]).toMatchObject({ prompt: "test", mode: "primary" })
    expect((result[display] as { hidden?: boolean }).hidden).not.toBe(true)
    expect(result["sisyphus"]).toMatchObject({ prompt: "test", mode: "primary", hidden: true, name: display })
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
    const remappedNames = Object.keys(result).filter((key) => {
      const value = result[key]
      return !(typeof value === "object" && value !== null && (value as { hidden?: boolean }).hidden === true)
    })

    // then
    expect(remappedNames).toEqual([
      getAgentListDisplayName("atlas"),
      getAgentListDisplayName("prometheus"),
      getAgentListDisplayName("hephaestus"),
      getAgentListDisplayName("sisyphus"),
    ])
  })

  it("keeps remapped core agent name fields aligned with OpenCode list ordering", () => {
    // given agents with raw config-key names
    const agents = {
      sisyphus: { name: "sisyphus", prompt: "test", mode: "primary" },
      hephaestus: { name: "hephaestus", prompt: "test", mode: "primary" },
      prometheus: { name: "prometheus", prompt: "test", mode: "primary" },
      atlas: { name: "atlas", prompt: "test", mode: "primary" },
      oracle: { name: "oracle", prompt: "test", mode: "subagent" },
    }

    // when remapping
    const result = remapAgentKeysToDisplayNames(agents)

    // then keys and names both use the same runtime-facing list names
    const visibleKeys = Object.keys(result).filter((key) => {
      const value = result[key]
      return !(typeof value === "object" && value !== null && (value as { hidden?: boolean }).hidden === true)
    })
    expect(visibleKeys.slice(0, 4)).toEqual([
      getAgentListDisplayName("sisyphus"),
      getAgentListDisplayName("hephaestus"),
      getAgentListDisplayName("prometheus"),
      getAgentListDisplayName("atlas"),
    ])
    expect(result[getAgentListDisplayName("sisyphus")]).toEqual({
      name: getAgentListDisplayName("sisyphus"),
      prompt: "test",
      mode: "primary",
    })
    expect(result[getAgentListDisplayName("hephaestus")]).toEqual({
      name: getAgentListDisplayName("hephaestus"),
      prompt: "test",
      mode: "primary",
    })
    expect(result[getAgentListDisplayName("prometheus")]).toEqual({
      name: getAgentListDisplayName("prometheus"),
      prompt: "test",
      mode: "primary",
    })
    expect(result[getAgentListDisplayName("atlas")]).toEqual({
      name: getAgentListDisplayName("atlas"),
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
      prometheus: { prompt: "test", mode: "primary" },
      atlas: { prompt: "test", mode: "primary" },
    }

    // when remapping
    const result = remapAgentKeysToDisplayNames(agents)

    // then runtime-facing names stay aligned even when builtin configs omit name
    expect(result[getAgentListDisplayName("sisyphus")]).toEqual({
      name: getAgentListDisplayName("sisyphus"),
      prompt: "test",
      mode: "primary",
    })
    expect(result[getAgentListDisplayName("hephaestus")]).toEqual({
      name: getAgentListDisplayName("hephaestus"),
      prompt: "test",
      mode: "primary",
    })
    expect(result[getAgentListDisplayName("prometheus")]).toEqual({
      name: getAgentListDisplayName("prometheus"),
      prompt: "test",
      mode: "primary",
    })
    expect(result[getAgentListDisplayName("atlas")]).toEqual({
      name: getAgentListDisplayName("atlas"),
      prompt: "test",
      mode: "primary",
    })
  })

  it("emits a single literal display-name row with no ZWSP for a single core agent", () => {
    // given a single core agent input
    const agents = {
      sisyphus: { foo: "bar" },
    }

    // when remapping
    const result = remapAgentKeysToDisplayNames(agents)

    // then the visible row is the clean literal display name; config key is hidden
    const displayName = getAgentListDisplayName("sisyphus")
    const visible = Object.keys(result).filter((key) => {
      const value = result[key]
      return !(typeof value === "object" && value !== null && (value as { hidden?: boolean }).hidden === true)
    })
    expect(visible).toEqual([displayName])
    expect(result[displayName]).toEqual({
      name: displayName,
      foo: "bar",
    })
    expect(result["sisyphus"]).toMatchObject({ hidden: true, name: displayName })
  })

  describe("displayName i18n override (#4004)", () => {
    it("uses per-agent displayName override when set", () => {
      // given sisyphus config with a Chinese displayName override
      const agents = {
        sisyphus: { prompt: "test", mode: "primary" },
      }
      const overrides = {
        sisyphus: { displayName: "总指挥" },
      }

      // when remapping with overrides
      const result = remapAgentKeysToDisplayNames(agents, overrides)

      // then the localized name is used instead of "Sisyphus - Ultraworker"
      expect(result["总指挥"]).toBeDefined()
      expect((result["总指挥"] as Record<string, unknown>).name).toBe("总指挥")
      expect(result["Sisyphus - Ultraworker"]).toBeUndefined()
    })

    it("falls back to hardcoded English name when displayName is not set", () => {
      // given sisyphus config without displayName override
      const agents = {
        sisyphus: { prompt: "test", mode: "primary" },
      }
      const overrides = {
        sisyphus: { model: "claude-opus-4-7" },
      }

      // when remapping with overrides that have no displayName
      const result = remapAgentKeysToDisplayNames(agents, overrides)

      // then the legacy AGENT_DISPLAY_NAMES value is used
      expect(result[getAgentListDisplayName("sisyphus")]).toBeDefined()
      expect(result["总指挥"]).toBeUndefined()
    })

    it("falls back to hardcoded English name when no overrides are passed", () => {
      // given sisyphus config with no overrides at all
      const agents = {
        sisyphus: { prompt: "test", mode: "primary" },
      }

      // when remapping without overrides
      const result = remapAgentKeysToDisplayNames(agents)

      // then the legacy AGENT_DISPLAY_NAMES value is used
      expect(result[getAgentListDisplayName("sisyphus")]).toBeDefined()
    })
  })
})
