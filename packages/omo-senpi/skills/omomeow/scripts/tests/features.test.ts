import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { DEFAULT_SETTINGS } from "../lib/config.mjs"
import { emptyState, forgetFeature, planReconcile, recordFeature, validateManifest } from "../lib/features.mjs"

const skillDir = join(import.meta.dir, "..", "..")
const shippedManifest = validateManifest(JSON.parse(readFileSync(join(skillDir, "manifest.json"), "utf8")))

const settings = (overrides: { enabled?: boolean; interval?: number } = {}) => ({
  language: "en",
  nudge: { enabled: overrides.enabled ?? true, interval_minutes: overrides.interval ?? 30 },
})

const setupOnlyManifest = { schemaVersion: 1, features: shippedManifest.features.filter((feature: { id: string }) => feature.id === "setup") }

describe("shipped manifest", () => {
  test("#given the shipped manifest #when validated #then every feature doc exists in the skill", () => {
    for (const feature of shippedManifest.features) {
      expect(existsSync(join(skillDir, feature.doc)), `${feature.id} doc ${feature.doc}`).toBe(true)
    }
  })

  test("#given the shipped manifest #when its config paths are read #then each one names a real setting", () => {
    for (const feature of shippedManifest.features) {
      for (const path of [feature.enabledBy, ...(feature.configKeys ?? [])].filter(Boolean)) {
        const value = path.split(".").reduce((node: any, key: string) => node?.[key], DEFAULT_SETTINGS)
        expect(value, `${feature.id} references ${path}`).not.toBeUndefined()
      }
    }
  })
})

describe("planReconcile", () => {
  test("#given no installed state #when reconciled #then every enabled feature is new, setup first", () => {
    const plan = planReconcile({ manifest: shippedManifest, state: emptyState(), settings: settings() })

    expect(plan.fresh).toBe(true)
    expect(plan.install.map((entry: { id: string }) => entry.id)).toEqual(["setup", "nudge"])
    expect(plan.update).toEqual([])
    expect(plan.remove).toEqual([])
  })

  test("#given a user installed before nudge shipped #when the new manifest arrives #then only nudge is installed", () => {
    const before = recordFeature({ manifest: setupOnlyManifest, state: emptyState(), settings: settings(), id: "setup" })

    const plan = planReconcile({ manifest: shippedManifest, state: before, settings: settings() })

    expect(plan.fresh).toBe(false)
    expect(plan.install.map((entry: { id: string }) => entry.id)).toEqual(["nudge"])
    expect(plan.current).toEqual(["setup"])
  })

  test("#given everything recorded #when reconciled again #then nothing is pending", () => {
    let state = recordFeature({ manifest: shippedManifest, state: emptyState(), settings: settings(), id: "setup" })
    state = recordFeature({ manifest: shippedManifest, state, settings: settings(), id: "nudge", data: { scheduleId: "sch_1" } })

    const plan = planReconcile({ manifest: shippedManifest, state, settings: settings() })

    expect(plan.install).toEqual([])
    expect(plan.update).toEqual([])
    expect(plan.remove).toEqual([])
    expect(plan.current).toEqual(["setup", "nudge"])
  })

  test("#given a manifest version bump #when reconciled #then the feature is an update carrying its recorded data", () => {
    const state = recordFeature({ manifest: shippedManifest, state: emptyState(), settings: settings(), id: "nudge", data: { scheduleId: "sch_1" } })
    const bumped = { schemaVersion: 1, features: shippedManifest.features.map((feature: { id: string; version: number }) => (feature.id === "nudge" ? { ...feature, version: feature.version + 1 } : feature)) }

    const plan = planReconcile({ manifest: bumped, state, settings: settings() })

    expect(plan.update).toHaveLength(1)
    expect(plan.update[0]).toMatchObject({ id: "nudge", reason: "version", data: { scheduleId: "sch_1" } })
  })

  test("#given the interval changed after install #when reconciled #then nudge is a config update", () => {
    const state = recordFeature({ manifest: shippedManifest, state: emptyState(), settings: settings({ interval: 30 }), id: "nudge" })

    const plan = planReconcile({ manifest: shippedManifest, state, settings: settings({ interval: 10 }) })

    expect(plan.update[0]).toMatchObject({ id: "nudge", reason: "config", previousConfig: { "nudge.interval_minutes": 30 }, config: { "nudge.interval_minutes": 10 } })
  })

  test("#given nudge disabled #when reconciled #then an installed nudge is removed and a missing one is skipped", () => {
    const installed = recordFeature({ manifest: shippedManifest, state: emptyState(), settings: settings(), id: "nudge", data: { scheduleId: "sch_9" } })

    const removePlan = planReconcile({ manifest: shippedManifest, state: installed, settings: settings({ enabled: false }) })
    const skipPlan = planReconcile({ manifest: shippedManifest, state: emptyState(), settings: settings({ enabled: false }) })

    expect(removePlan.remove[0]).toMatchObject({ id: "nudge", reason: "disabled", data: { scheduleId: "sch_9" } })
    expect(skipPlan.install.map((entry: { id: string }) => entry.id)).toEqual(["setup"])
    expect(skipPlan.skipped).toEqual([{ id: "nudge", reason: "disabled" }])
  })

  test("#given a feature no longer shipped #when reconciled #then it is removed as retired", () => {
    const state = { ...emptyState(), features: { legacy: { version: 1, installedAt: "2026-01-01T00:00:00.000Z", config: {}, data: { x: 1 } } } }

    const plan = planReconcile({ manifest: shippedManifest, state, settings: settings() })

    expect(plan.remove).toEqual([{ id: "legacy", version: 1, doc: null, summary: "", reason: "retired", data: { x: 1 } }])
  })
})

describe("recordFeature / forgetFeature", () => {
  test("#given an unknown feature id #when recorded #then it throws", () => {
    expect(() => recordFeature({ manifest: shippedManifest, state: emptyState(), settings: settings(), id: "nope" })).toThrow("unknown feature nope")
  })

  test("#given a recorded feature #when forgotten #then it is no longer installed", () => {
    const state = recordFeature({ manifest: shippedManifest, state: emptyState(), settings: settings(), id: "setup" })

    expect(forgetFeature({ state, id: "setup" }).features).toEqual({})
  })

  test("#given a manifest with a duplicate id #when validated #then it is rejected", () => {
    const duplicate = { schemaVersion: 1, features: [shippedManifest.features[0], shippedManifest.features[0]] }

    expect(() => validateManifest(duplicate)).toThrow("duplicate feature id")
  })
})
