import { describe, it, expect } from "bun:test"
import { getCategoryConfigKey, getCategoryDisplayName, setCategoryDisplayNameOverrides } from "./category-display-names"

describe("getCategoryDisplayName", () => {
  it("#given no overrides #when getCategoryDisplayName called #then returns category key as-is", () => {
    // given no overrides
    setCategoryDisplayNameOverrides({})

    // when getCategoryDisplayName called
    const result = getCategoryDisplayName("visual-engineering")

    // then returns key as-is
    expect(result).toBe("visual-engineering")
  })

  it("#given override set #when getCategoryDisplayName called #then returns override value", () => {
    // given override for visual-engineering
    setCategoryDisplayNameOverrides({ "visual-engineering": "Peacock" })

    // when getCategoryDisplayName called
    const result = getCategoryDisplayName("visual-engineering")

    // then returns override
    expect(result).toBe("Peacock")

    // cleanup
    setCategoryDisplayNameOverrides({})
  })

  it("#given override set for different key #when getCategoryDisplayName called #then returns key as-is", () => {
    // given override for ultrabrain only
    setCategoryDisplayNameOverrides({ ultrabrain: "Octopus" })

    // when getCategoryDisplayName called for visual-engineering
    const result = getCategoryDisplayName("visual-engineering")

    // then returns key as-is (no override for this key)
    expect(result).toBe("visual-engineering")

    // cleanup
    setCategoryDisplayNameOverrides({})
  })
})

describe("getCategoryConfigKey", () => {
  it("#given override set #when getCategoryConfigKey called with display name #then returns config key", () => {
    // given override
    setCategoryDisplayNameOverrides({ deep: "Whale" })

    // when reverse lookup by display name
    const result = getCategoryConfigKey("Whale")

    // then returns config key
    expect(result).toBe("deep")

    // cleanup
    setCategoryDisplayNameOverrides({})
  })

  it("#given no overrides #when getCategoryConfigKey called #then returns input as-is", () => {
    // given no overrides
    setCategoryDisplayNameOverrides({})

    // when getCategoryConfigKey called with raw key
    const result = getCategoryConfigKey("quick")

    // then returns input as-is
    expect(result).toBe("quick")
  })
})
