import { describe, it, expect } from "bun:test"
import { initDisplayNameOverrides } from "./display-name-initializer"
import { getAgentDisplayName, setAgentDisplayNameOverrides } from "./agent-display-names"
import { getCategoryDisplayName, setCategoryDisplayNameOverrides } from "./category-display-names"
import type { OhMyOpenCodeConfig } from "../config"

describe("initDisplayNameOverrides", () => {
  it("#given config with agent display_name #when initDisplayNameOverrides called #then agent override applied", () => {
    // given config with agent display_name
    const config = {
      agents: {
        sisyphus: { display_name: "Ox (Ultraworker)" },
      },
    } as OhMyOpenCodeConfig

    // when initDisplayNameOverrides called
    initDisplayNameOverrides(config)

    // then agent override applied
    expect(getAgentDisplayName("sisyphus")).toBe("Ox (Ultraworker)")

    // cleanup
    setAgentDisplayNameOverrides({})
  })

  it("#given config with category display_name #when initDisplayNameOverrides called #then category override applied", () => {
    // given config with category display_name
    const config = {
      categories: {
        deep: { display_name: "Whale" },
      },
    } as OhMyOpenCodeConfig

    // when initDisplayNameOverrides called
    initDisplayNameOverrides(config)

    // then category override applied
    expect(getCategoryDisplayName("deep")).toBe("Whale")

    // cleanup
    setCategoryDisplayNameOverrides({})
  })

  it("#given empty config #when initDisplayNameOverrides called #then overrides reset to empty", () => {
    // given previous overrides exist
    setAgentDisplayNameOverrides({ sisyphus: "Old Name" })
    setCategoryDisplayNameOverrides({ quick: "Old Cat" })
    const config = {} as OhMyOpenCodeConfig

    // when initDisplayNameOverrides called with empty config
    initDisplayNameOverrides(config)

    // then overrides are cleared and defaults restored
    expect(getAgentDisplayName("sisyphus")).toBe("Sisyphus (Ultraworker)")
    expect(getCategoryDisplayName("quick")).toBe("quick")
  })

  it("#given config with agents but no display_name #when initDisplayNameOverrides called #then no overrides applied", () => {
    // given config with agent config but no display_name
    const config = {
      agents: {
        sisyphus: { temperature: 0.5 },
      },
    } as OhMyOpenCodeConfig

    // when initDisplayNameOverrides called
    initDisplayNameOverrides(config)

    // then defaults preserved
    expect(getAgentDisplayName("sisyphus")).toBe("Sisyphus (Ultraworker)")

    // cleanup
    setAgentDisplayNameOverrides({})
  })
})
