/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import catalog from "./orcarouter-models.json"

type CatalogEntry = {
  readonly name: string
  readonly reasoning: boolean
  readonly tool_call: boolean
  readonly attachment: boolean
  readonly modalities: { readonly input: readonly string[]; readonly output: readonly string[] }
  readonly cost: {
    readonly input: number
    readonly output: number
    readonly cache_read: number
    readonly cache_write: number
  }
  readonly limit: { readonly context: number; readonly output: number }
}

const entries = Object.entries(catalog as Record<string, CatalogEntry>)

describe("checked-in orcarouter-models.json", () => {
  test("carries the gateway's routing products", () => {
    // given the checked-in catalog
    // when its entries are counted
    // then it covers the orcarouter/* routing namespace
    expect(entries.length).toBeGreaterThanOrEqual(4)
  })

  test("keys are orcarouter-prefixed model ids in lexicographic order", () => {
    // given the catalog keys
    const keys = entries.map(([id]) => id)

    // when compared against their sorted copy
    // then they are already sorted and every id carries the gateway prefix
    expect(keys).toEqual([...keys].sort())
    for (const id of keys) {
      expect(id.startsWith("orcarouter/")).toBe(true)
      expect(id.split("/").every((part) => part.length > 0)).toBe(true)
    }
  })

  test("every entry has a usable name, limits, costs and text output modality", () => {
    // given each catalog entry
    for (const [id, entry] of entries) {
      // when its required config fields are inspected
      // then each one is populated as opencode's model config requires
      expect(entry.name.length, `${id} name`).toBeGreaterThan(0)
      expect(entry.limit.context, `${id} limit.context`).toBeGreaterThan(0)
      expect(entry.limit.output, `${id} limit.output`).toBeGreaterThan(0)
      expect(typeof entry.cost.input, `${id} cost.input`).toBe("number")
      expect(typeof entry.cost.output, `${id} cost.output`).toBe("number")
      expect(typeof entry.cost.cache_read, `${id} cost.cache_read`).toBe("number")
      expect(typeof entry.cost.cache_write, `${id} cost.cache_write`).toBe("number")
      expect(entry.modalities.output, `${id} modalities.output`).toEqual(["text"])
      expect(entry.modalities.input, `${id} modalities.input`).toContain("text")
    }
  })

  test("every entry is tool-capable and flags attachments only for image inputs", () => {
    // given each catalog entry
    for (const [id, entry] of entries) {
      // when capability flags are inspected
      // then tool calling is guaranteed and attachment tracks the image modality
      expect(entry.tool_call, `${id} tool_call`).toBe(true)
      expect(entry.attachment, `${id} attachment`).toBe(entry.modalities.input.includes("image"))
      expect(typeof entry.reasoning, `${id} reasoning`).toBe("boolean")
    }
  })

  test("ships orcarouter/auto with the models.dev metadata", () => {
    // given the auto router entry
    const auto = (catalog as Record<string, CatalogEntry>)["orcarouter/auto"]

    // when its capabilities are inspected
    // then the models.dev-backed name, modalities and limits are preserved
    expect(auto?.name).toBe("OrcaRouter Auto")
    expect(auto?.modalities.input).toContain("image")
    expect(auto?.limit.context).toBe(128000)
  })
})
