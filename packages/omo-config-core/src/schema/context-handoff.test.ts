import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  loadOmoConfig,
  OmoConfigSchema,
  resolveOmoContextHandoffSettings,
} from "../index"

describe("omo config context_handoff section", () => {
  test("#given context_handoff is absent #when resolving settings #then opt-in defaults are returned", () => {
    // given
    const config = OmoConfigSchema.parse({})

    // when
    const settings = resolveOmoContextHandoffSettings(config)

    // then
    expect(settings).toEqual({ enabled: false, thresholdPercent: 85, repeatLimit: 3, repeatWindowMs: 600_000 })
  })

  test("#given explicit context_handoff values #when parsed and resolved #then both values are preserved", () => {
    // given
    const config = OmoConfigSchema.parse({
      context_handoff: { enabled: true, threshold_percent: 72, compaction_repeat_limit: 4, compaction_repeat_window_minutes: 15 },
    })

    // when
    const settings = resolveOmoContextHandoffSettings(config)

    // then
    expect(settings).toEqual({ enabled: true, thresholdPercent: 72, repeatLimit: 4, repeatWindowMs: 900_000 })
  })

  test("#given an out-of-range threshold #when parsed #then the config is rejected", () => {
    // given
    const config = { context_handoff: { threshold_percent: 100 } }

    // when
    const result = OmoConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(false)
    if (result.success) throw new Error("Expected config parsing to fail")
    expect(result.error.issues.map((issue) => issue.path.join("."))).toContain("context_handoff.threshold_percent")
  })

  test("#given a [native] context_handoff override #when loaded with harness senpi #then the override is resolved", () => {
    // given
    const root = mkdtempSync(join(tmpdir(), "omo-config-context-handoff-"))
    const homeDir = join(root, "home")
    const cwd = join(homeDir, "project")
    mkdirSync(join(homeDir, ".omo"), { recursive: true })
    mkdirSync(cwd, { recursive: true })
    writeFileSync(
      join(homeDir, ".omo", "omo.jsonc"),
      `{"context_handoff":{"enabled":false,"threshold_percent":85},"[native]":{"context_handoff":{"enabled":true,"threshold_percent":70}}}`,
    )

    try {
      // when
      const result = loadOmoConfig({
        cwd,
        env: { HOME: homeDir },
        harness: "senpi",
        platform: "linux",
      })

      // then
      expect(result.diagnostics).toEqual([])
      expect(resolveOmoContextHandoffSettings(result.config)).toEqual({
        enabled: true,
        thresholdPercent: 70,
        repeatLimit: 3,
        repeatWindowMs: 600_000,
      })
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })
})
