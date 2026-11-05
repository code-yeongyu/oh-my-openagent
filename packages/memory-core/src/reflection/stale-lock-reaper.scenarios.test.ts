import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

import {
  REAPER_SCENARIOS,
  REFLECTION_DIR,
  STRANDED_RUN_DIR,
  STRANDED_SCENARIOS,
  reaperProbeFor,
} from "./stale-holder.scenarios.test-support"
import { decideStaleReflectionLock, decideStrandedRun } from "./stale-lock-reaper"

describe("stale reflection-lock reaper decision table (#11976)", () => {
  test.each(REAPER_SCENARIOS.map((scenario) => [scenario.rule === undefined ? scenario.name : `${scenario.name} [rule:${scenario.rule}]`, scenario] as const))(
    "#given %s #when the active lock is decided #then the decision is exact",
    async (_name, scenario) => {
      expect((await decideStaleReflectionLock(REFLECTION_DIR, reaperProbeFor(scenario.facts))).decision).toEqual(scenario.expected)
    },
  )

  test.each(STRANDED_SCENARIOS.map((scenario) => [scenario.rule === undefined ? scenario.name : `${scenario.name} [rule:${scenario.rule}]`, scenario] as const))(
    "#given %s #when a run dir with no terminal state is decided #then the decision is exact",
    async (_name, scenario) => {
      expect(await decideStrandedRun(STRANDED_RUN_DIR, reaperProbeFor(scenario.facts))).toEqual(scenario.expected)
    },
  )

  // Generated-bundle contract: `omo doctor` runs a bundle of this table, and the parity test only
  // compares the scenarios listed here, so every rule in the source must have one.
  test("#given the reaper source #when its rule tags are listed #then each has exactly the scenarios that name it", () => {
    const source = readFileSync(new URL("./stale-lock-reaper.ts", import.meta.url), "utf8")
    const tags = [...source.matchAll(/\/\/ rule:([\w-]+)/g)].map((match) => match[1]).sort()
    const named = [...REAPER_SCENARIOS, ...STRANDED_SCENARIOS].flatMap((scenario) => scenario.rule === undefined ? [] : [scenario.rule]).sort()
    expect(named).toEqual(tags)
  })
})
