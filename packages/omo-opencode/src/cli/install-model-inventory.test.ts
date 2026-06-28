/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { createModelInventory, resolveOpenCodeInstallModelInventory } from "./install-model-inventory"

describe("install model inventory", () => {
  test("#given OpenCode inventory output #when resolving inventory #then keeps exact available models", async () => {
    // #given
    const command = async () => ["openai/gpt-5.5", "anthropic/claude-opus-4-7", ""].join("\n")

    // #when
    const result = await resolveOpenCodeInstallModelInventory({ command })

    // #then
    expect(result).toEqual({
      kind: "available",
      inventory: createModelInventory(["openai/gpt-5.5", "anthropic/claude-opus-4-7"]),
    })
  })

  test("#given OpenCode inventory command failure #when resolving inventory #then returns fallback warning", async () => {
    // #given
    const command = async () => {
      throw new Error("fake opencode models failure")
    }

    // #when
    const result = await resolveOpenCodeInstallModelInventory({ command })

    // #then
    expect(result.kind).toBe("unavailable")
    if (result.kind === "unavailable") {
      expect(result.warning).toContain("fake opencode models failure")
      expect(result.warning).toContain("static model fallback chains")
    }
  })
})
