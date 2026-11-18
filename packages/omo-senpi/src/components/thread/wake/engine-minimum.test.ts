import { describe, expect, test } from "bun:test"

import { engineDropsRetainedRecord, MIN_WAKE_ENGINE_VERSION } from "./engine-minimum"

// The release contract with senpi (#13037 A8.1): the wake turns on exactly from the first engine that carries senpi#6449.
// 2026.11.15 was tagged three minutes before that merge, so a pin one release too early would start a carrier on an engine
// that reopens every session it hands back.
describe("the wake's engine minimum", () => {
  test("#given the shipped minimum #then it is the first senpi release carrying senpi#6449", () => {
    expect(MIN_WAKE_ENGINE_VERSION).toBe("2026.11.15-2")
  })

  test.each([
    ["2026.11.13", false],
    ["2026.11.15", false],
    ["2026.11.15-1", false],
    ["2026.11.15-2", true],
    ["2026.11.15-3", true],
    ["2026.11.16", true],
    ["2026.11.15-2+build.7", true],
    ["not-a-version", false],
  ] as const)(
    "#given an engine reporting %s #when the shipped minimum is read #then the wake runs: %s",
    (version, runs) => {
      expect(engineDropsRetainedRecord(version)).toBe(runs)
    },
  )
})
