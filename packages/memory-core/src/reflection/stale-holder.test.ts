import { describe, expect, test } from "bun:test"

import { classifyReflectionLockHolder } from "./stale-holder"
import {
  deadHolder,
  LAUNCHER,
  lock,
  LOCK,
  REFLECTION_DIR,
  RUN,
  SCENARIOS,
  probeFor,
} from "./stale-holder.scenarios.test-support"

describe("reflection lock holder decision (#10377)", () => {
  // Each fail-closed rule has its own scenario that changes exactly one fact of a provably dead
  // holder, so removing that rule changes this scenario's verdict.
  test.each(
    SCENARIOS.map(
      (scenario) =>
        [scenario.rule === undefined ? scenario.name : `${scenario.name} [rule:${scenario.rule}]`, scenario] as const,
    ),
  )("#given %s #when the holder is classified #then the verdict is exact", async (_name, scenario) => {
    expect(await classifyReflectionLockHolder(REFLECTION_DIR, probeFor(scenario.facts))).toEqual(scenario.expected)
  })

  test("#given a start-identity reader that throws #when the launcher is alive #then it stays live instead of failing", async () => {
    const scenario = SCENARIOS.find((entry) => entry.rule === "pid-reused")
    if (scenario === undefined) throw new Error("missing scenario")
    const probe = {
      ...probeFor(scenario.facts),
      getProcessStartIdentity: async () => {
        throw new Error("ps failed")
      },
    }
    expect(await classifyReflectionLockHolder(REFLECTION_DIR, probe)).toEqual({
      state: "live",
      runId: "reflection-run-64",
    })
  })

  // #15362: an older reader recorded the launcher start as local wall time (`ps-lstart:`); the zone bound (UTC-12..UTC+14,
  // 15-minute steps), not the scheme, decides whether the live process started then.
  test.each([
    [
      "no zone offset maps onto",
      "dead",
      "ps-lstart:Tue Sep 15 14:59:03 2026",
      "ps-lstart-utc:Wed Sep 16 14:59:03 2026",
    ],
    [
      "a real zone offset maps onto",
      "live",
      "ps-lstart:Tue Sep 15 23:59:03 2026",
      "ps-lstart-utc:Tue Sep 15 14:59:03 2026",
    ],
  ] as const)(
    "#given a live launcher whose legacy ps-lstart start %s its live start #when the holder is classified #then it is %s",
    async (_name, state, recorded, actual) => {
      // given
      const facts = deadHolder({
        files: { [LOCK]: lock({ launcherProcessStart: recorded }) },
        pids: { [LAUNCHER]: "alive" },
        starts: { [LAUNCHER]: actual },
      })

      // when
      const verdict = await classifyReflectionLockHolder(REFLECTION_DIR, probeFor(facts))

      // then
      expect(verdict).toEqual({ state, runId: RUN })
    },
  )
})
