/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { createCodexModelInventory, resolveCodexInstallModelInventory } from "./codex-model-catalog"

describe("codex model catalog inventory", () => {
  test("#given Codex debug models JSON #when resolving inventory #then reads slug model names", async () => {
    // given
    const command = async () => JSON.stringify({ models: [{ slug: "gpt-5-codex" }, { slug: "gpt-5.5" }] })

    // when
    const result = await resolveCodexInstallModelInventory({
      codexHome: "/tmp/codex-home",
      cwd: "/tmp/repo",
      env: {},
      command,
    })

    // then
    expect(result).toEqual({ kind: "available", inventory: createCodexModelInventory(["gpt-5-codex", "gpt-5.5"]) })
  })

  test("#given Codex debug models failure #when resolving inventory #then returns static fallback warning", async () => {
    // given
    const command = async () => {
      throw new Error("fake codex debug models failure")
    }

    // when
    const result = await resolveCodexInstallModelInventory({
      codexHome: "/tmp/codex-home",
      cwd: "/tmp/repo",
      env: {},
      command,
    })

    // then
    expect(result.kind).toBe("unavailable")
    if (result.kind === "unavailable") {
      expect(result.warning).toContain("fake codex debug models failure")
      expect(result.warning).toContain("static model catalog")
    }
  })
})
