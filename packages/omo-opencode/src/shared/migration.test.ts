import { describe, expect, test } from "bun:test"

import {
  migrateAgentConfigToCategory,
  migrateAgentNames,
  migrateHookNames,
  migrateModelVersions,
} from "./migration"

describe("legacy migration maps", () => {
  test("#given renamed agents and hooks #when transforming #then current identifiers replace legacy identifiers", () => {
    const agents = migrateAgentNames({ OmO: { model: "provider/model" } })
    const hooks = migrateHookNames(["anthropic-auto-compact", "empty-message-sanitizer"])

    expect(agents).toEqual({ changed: true, migrated: { sisyphus: { model: "provider/model" } } })
    expect(hooks).toEqual({
      changed: true,
      migrated: ["anthropic-context-window-limit-recovery"],
      removed: ["empty-message-sanitizer"],
    })
  })

  test("#given a retired model and its recorded migration #when transforming #then the recorded value remains user-controlled", () => {
    const migrated = migrateModelVersions(
      { oracle: { model: "anthropic/claude-opus-4-4" } },
      new Set(["model-version:anthropic/claude-opus-4-4->anthropic/claude-opus-4-8"]),
    )

    expect(migrated.changed).toBe(false)
    expect(migrated.migrated.oracle).toEqual({ model: "anthropic/claude-opus-4-4" })
  })

  test("#given a category-mapped agent #when transforming #then its category replaces the retired model", () => {
    expect(migrateAgentConfigToCategory({ model: "openai/gpt-5.4", prompt: "be concise" })).toEqual({
      changed: true,
      migrated: { category: "ultrabrain", prompt: "be concise" },
    })
  })
})
