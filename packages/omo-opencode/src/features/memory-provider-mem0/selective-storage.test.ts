import { describe, expect, it } from "bun:test"
import {
  buildSelectiveStorageParams,
  getStoragePreset,
  mergeStorageRules,
  SelectiveStorageError,
  STORAGE_PRESETS,
  validateSelectiveStorage,
} from "./selective-storage"

describe("validateSelectiveStorage", () => {
  it("#given both rules #when validated #then passes", () => {
    expect(() =>
      validateSelectiveStorage({ includes: "prefs", excludes: "PII" }),
    ).not.toThrow()
  })

  it("#given no rules #when validated #then passes (noop)", () => {
    expect(() => validateSelectiveStorage({})).not.toThrow()
  })

  it("#given includes too long #when validated #then throws", () => {
    expect(() =>
      validateSelectiveStorage({ includes: "x".repeat(501) }),
    ).toThrow(SelectiveStorageError)
  })

  it("#given excludes too long #when validated #then throws", () => {
    expect(() =>
      validateSelectiveStorage({ excludes: "x".repeat(501) }),
    ).toThrow(/excludes/)
  })

  it("#given custom max length #when validated #then respects it", () => {
    expect(() =>
      validateSelectiveStorage({ includes: "x".repeat(150) }, 100),
    ).toThrow(/100/)
  })
})

describe("buildSelectiveStorageParams", () => {
  it("#given both rules #when built #then returns both", () => {
    const params = buildSelectiveStorageParams({
      includes: "prefs",
      excludes: "PII",
    })
    expect(params.includes).toBe("prefs")
    expect(params.excludes).toBe("PII")
  })

  it("#given only includes #when built #then omits excludes", () => {
    const params = buildSelectiveStorageParams({ includes: "prefs" })
    expect(params.includes).toBe("prefs")
    expect(params.excludes).toBeUndefined()
  })

  it("#given empty strings #when built #then omits empty values", () => {
    const params = buildSelectiveStorageParams({ includes: "   ", excludes: "" })
    expect(params.includes).toBeUndefined()
    expect(params.excludes).toBeUndefined()
  })

  it("#given whitespace #when built #then trims", () => {
    const params = buildSelectiveStorageParams({ includes: "  pattern  " })
    expect(params.includes).toBe("pattern")
  })
})

describe("STORAGE_PRESETS", () => {
  it("#given preset name #when fetched #then returns rules", () => {
    const preset = getStoragePreset("preferences_only")
    expect(preset?.includes).toContain("preferences")
    expect(preset?.excludes).toContain("personal identifiers")
  })

  it("#given unknown preset #when fetched #then returns undefined", () => {
    expect(getStoragePreset("nonexistent")).toBeUndefined()
  })

  it("#given no_pii preset #when fetched #then has excludes only", () => {
    const preset = STORAGE_PRESETS.no_pii
    expect(preset?.excludes).toBeDefined()
    expect(preset?.includes).toBeUndefined()
  })
})

describe("mergeStorageRules", () => {
  it("#given base and override #when merged #then override wins", () => {
    const merged = mergeStorageRules(
      { includes: "base-in", excludes: "base-ex" },
      { includes: "override-in" },
    )
    expect(merged.includes).toBe("override-in")
    expect(merged.excludes).toBe("base-ex")
  })

  it("#given empty override #when merged #then base preserved", () => {
    const merged = mergeStorageRules(
      { includes: "base-in" },
      {},
    )
    expect(merged.includes).toBe("base-in")
  })
})
