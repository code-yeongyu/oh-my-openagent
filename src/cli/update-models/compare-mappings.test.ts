import { describe, it, expect } from "bun:test"
import { isDefaultEntry, compareMappings } from "./compare-mappings.js"
import type { ModelMappingEntry } from "./types.js"

describe("isDefaultEntry", () => {
  it("returns true for identical entries with no fallback_models", () => {
    const current: ModelMappingEntry = { model: "claude-sonnet-4" }
    const generated: ModelMappingEntry = { model: "claude-sonnet-4" }
    expect(isDefaultEntry(current, generated)).toBe(true)
  })

  it("returns true for identical entries with matching fallback_models", () => {
    const current: ModelMappingEntry = {
      model: "claude-sonnet-4",
      fallback_models: [{ model: "claude-3-5-sonnet-20241022" }],
    }
    const generated: ModelMappingEntry = {
      model: "claude-sonnet-4",
      fallback_models: [{ model: "claude-3-5-sonnet-20241022" }],
    }
    expect(isDefaultEntry(current, generated)).toBe(true)
  })

  it("returns false when model differs", () => {
    const current: ModelMappingEntry = { model: "claude-sonnet-4" }
    const generated: ModelMappingEntry = { model: "claude-3-5-sonnet" }
    expect(isDefaultEntry(current, generated)).toBe(false)
  })

  it("returns false when variant differs", () => {
    const current: ModelMappingEntry = { model: "claude-sonnet-4", variant: "custom" }
    const generated: ModelMappingEntry = { model: "claude-sonnet-4", variant: "standard" }
    expect(isDefaultEntry(current, generated)).toBe(false)
  })

  it("returns false when fallback_models count differs", () => {
    const current: ModelMappingEntry = {
      model: "claude-sonnet-4",
      fallback_models: [{ model: "claude-3-5-sonnet-20241022" }],
    }
    const generated: ModelMappingEntry = {
      model: "claude-sonnet-4",
      fallback_models: [],
    }
    expect(isDefaultEntry(current, generated)).toBe(false)
  })

  it("returns false when fallback_models content differs", () => {
    const current: ModelMappingEntry = {
      model: "claude-sonnet-4",
      fallback_models: [{ model: "claude-3-5-sonnet-20241022" }],
    }
    const generated: ModelMappingEntry = {
      model: "claude-sonnet-4",
      fallback_models: [{ model: "claude-3-opus" }],
    }
    expect(isDefaultEntry(current, generated)).toBe(false)
  })

  it("handles undefined fallback_models vs empty array", () => {
    const current: ModelMappingEntry = { model: "claude-sonnet-4" }
    const generated: ModelMappingEntry = {
      model: "claude-sonnet-4",
      fallback_models: [],
    }
    expect(isDefaultEntry(current, generated)).toBe(true)
  })

  it("handles multiple fallback models", () => {
    const current: ModelMappingEntry = {
      model: "claude-sonnet-4",
      fallback_models: [
        { model: "claude-3-5-sonnet-20241022" },
        { model: "claude-3-haiku" },
      ],
    }
    const generated: ModelMappingEntry = {
      model: "claude-sonnet-4",
      fallback_models: [
        { model: "claude-3-5-sonnet-20241022" },
        { model: "claude-3-haiku" },
      ],
    }
    expect(isDefaultEntry(current, generated)).toBe(true)
  })
})

describe("compareMappings", () => {
  it("returns empty results for identical mappings", () => {
    const current: Record<string, ModelMappingEntry> = {
      "claude-sonnet": { model: "claude-sonnet-4" },
    }
    const generated: Record<string, ModelMappingEntry> = {
      "claude-sonnet": { model: "claude-sonnet-4" },
    }
    const result = compareMappings(current, generated)
    expect(result.toUpdate).toEqual({})
    expect(result.toPreserve).toEqual(["claude-sonnet"])
    expect(result.toAdd).toEqual({})
  })

  it("marks new entries in generated as toAdd", () => {
    const current: Record<string, ModelMappingEntry> = {}
    const generated: Record<string, ModelMappingEntry> = {
      "claude-sonnet": { model: "claude-sonnet-4" },
    }
    const result = compareMappings(current, generated)
    expect(result.toAdd).toEqual({ "claude-sonnet": { model: "claude-sonnet-4" } })
    expect(result.toPreserve).toEqual([])
    expect(result.toUpdate).toEqual({})
  })

  it("marks custom entries (not matching defaults) as toUpdate", () => {
    const current: Record<string, ModelMappingEntry> = {
      "claude-sonnet": { model: "claude-sonnet-4", variant: "custom" },
    }
    const generated: Record<string, ModelMappingEntry> = {
      "claude-sonnet": { model: "claude-sonnet-4" },
    }
    const result = compareMappings(current, generated)
    expect(result.toUpdate).toEqual({ "claude-sonnet": { model: "claude-sonnet-4" } })
    expect(result.toPreserve).toEqual([])
  })

  it("marks default-matching entries as toPreserve", () => {
    const current: Record<string, ModelMappingEntry> = {
      "claude-sonnet": { model: "claude-sonnet-4" },
    }
    const generated: Record<string, ModelMappingEntry> = {
      "claude-sonnet": { model: "claude-sonnet-4" },
    }
    const result = compareMappings(current, generated)
    expect(result.toPreserve).toEqual(["claude-sonnet"])
  })

  it("handles multiple entries with mixed results", () => {
    const current: Record<string, ModelMappingEntry> = {
      "claude-sonnet": { model: "claude-sonnet-4" },
      "claude-opus": { model: "claude-opus-3", variant: "custom" },
      "gemini": { model: "gemini-2-5-pro" },
    }
    const generated: Record<string, ModelMappingEntry> = {
      "claude-sonnet": { model: "claude-sonnet-4" },
      "claude-opus": { model: "claude-opus-3" },
      "gemini": { model: "gemini-2-5-pro" },
      "llama": { model: "llama-3-1-8b" },
    }
    const result = compareMappings(current, generated)
    expect(result.toPreserve).toEqual(["claude-sonnet", "gemini"])
    expect(result.toUpdate).toEqual({ "claude-opus": { model: "claude-opus-3" } })
    expect(result.toAdd).toEqual({ "llama": { model: "llama-3-1-8b" } })
  })

  it("handles empty current mapping", () => {
    const current: Record<string, ModelMappingEntry> = {}
    const generated: Record<string, ModelMappingEntry> = {
      "claude-sonnet": { model: "claude-sonnet-4" },
      "gemini": { model: "gemini-2-5-pro" },
    }
    const result = compareMappings(current, generated)
    expect(result.toAdd).toEqual(generated)
    expect(result.toPreserve).toEqual([])
    expect(result.toUpdate).toEqual({})
  })

  it("handles empty generated mapping", () => {
    const current: Record<string, ModelMappingEntry> = {
      "claude-sonnet": { model: "claude-sonnet-4" },
    }
    const generated: Record<string, ModelMappingEntry> = {}
    const result = compareMappings(current, generated)
    expect(result.toAdd).toEqual({})
    expect(result.toPreserve).toEqual([])
    expect(result.toUpdate).toEqual({})
  })
})