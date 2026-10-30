/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { migrateModelVersions } from "./model-versions"

const OLD_KEY_TO_PREVIOUS = "model-version:anthropic/claude-opus-4-4->anthropic/claude-opus-4-8"

describe("migrateModelVersions applied-migration skip", () => {
  test("#given a migration to any earlier target already recorded #when the source model appears again #then the user's reverted value is never overridden", () => {
    // A user who was auto-migrated claude-opus-4-4 -> claude-opus-4-8 under the old key, then deliberately put
    // claude-opus-4-4 back. The new claude-opus-4-4 -> claude-opus-5-5 key is not in their sidecar, so a target-keyed skip
    // would rewrite their choice. A source-keyed skip must not.
    const configs = { oracle: { model: "anthropic/claude-opus-4-4" } }
    const applied = new Set([OLD_KEY_TO_PREVIOUS])

    const result = migrateModelVersions(configs, applied)

    expect(result.changed).toBe(false)
    expect(result.migrated.oracle).toEqual({ model: "anthropic/claude-opus-4-4" })
    expect(result.newMigrations).toEqual([])
  })

  test("#given no migration recorded for the source model #when migrating #then the config moves to the current target", () => {
    const configs = { oracle: { model: "anthropic/claude-opus-4-4" } }

    const result = migrateModelVersions(configs, new Set())

    expect(result.changed).toBe(true)
    expect(result.migrated.oracle).toEqual({ model: "anthropic/claude-opus-5-5" })
  })
})
