import { describe, expect, test } from "bun:test"

import { PORT_EFFECTS } from "../../packages/omo-senpi/src/components/omo-sdk/contract/ports"
import { type ConformanceContext, conformanceProblems } from "./conformance"
import { scenario } from "./conformance-fixture"
import { runEffectScenarios, type ScenarioRun } from "./conformance-run"
import type { TableScenario } from "./expectation"
import { virtualClock } from "./fakes/clock"
import { scenarioSetup } from "./fakes/setup"
import { allRows, loadDomainFiles } from "./registry"
import { loadScenarioTable } from "./scenario-table"

// Slice T1b: a scenario states a call's deadline (`options`, the member's second argument) and how long a fake port call
// takes on the virtual clock (`takes_ms`), so a deadline shorter than that fires with no real wait. A call that states no
// options and no abort is made with its input alone; a deadline that fires answers its refusal, so a scenario expecting
// the effect then fails; and a deadline row whose port call takes no time no longer passes.

const CONTROLS = ["interrupt", "close", "setModel", "setReasoning", "rename", "archive"].map(
  (name) => `threads.${name}`,
)
const WAITS = /\/(caller-cancels|deadline-passes)/
const table = loadScenarioTable()
  .flatMap((file) => file.scenarios)
  .filter((entry) => CONTROLS.includes(entry.row))
const waits = table.filter((entry) => WAITS.test(entry.id))
const rows = allRows(loadDomainFiles())
  .filter((row) => CONTROLS.includes(row.id))
  .map((row) => ({
    ...row,
    scenarios: {
      effect: table.filter((s) => s.row === row.id && s.kind === "effect").map((s) => s.id),
      refusal: table.filter((s) => s.row === row.id && s.kind === "refusal").map((s) => s.id),
    },
  }))
const CONTEXT: ConformanceContext = { effects: PORT_EFFECTS }

// The changed scenario is listed under its own kind, so a control fails on the answer, never on the row's listing.
async function judged(changed: TableScenario): Promise<string[]> {
  const listed = rows.find((candidate) => candidate.id === changed.row)
  if (listed === undefined) throw new Error(`no row ${changed.row}`)
  const others = (ids: readonly string[]) => ids.filter((id) => id !== changed.id)
  const row = {
    ...listed,
    scenarios: {
      effect: [...others(listed.scenarios.effect), ...(changed.kind === "effect" ? [changed.id] : [])],
      refusal: [...others(listed.scenarios.refusal), ...(changed.kind === "refusal" ? [changed.id] : [])],
    },
  }
  const records = await runEffectScenarios(rows, [{ scenario: changed, setup: () => scenarioSetup(changed) }])
  return conformanceProblems([row], new Set(), records, CONTEXT).filter(
    (problem) => problem.includes(`scenario ${changed.id} `) || problem.includes(`scenario ${changed.id}:`),
  )
}
const of = (id: string): TableScenario => {
  const found = waits.find((entry) => entry.id === id)
  if (found === undefined) throw new Error(`no scenario ${id}`)
  return found
}

describe("the call's second argument", () => {
  const seen = async (stated: TableScenario): Promise<unknown[]> => {
    let args: unknown[] = []
    const run: ScenarioRun = {
      scenario: stated,
      setup: () => ({
        root: {
          threads: {
            locate: (...called: unknown[]) => {
              args = called
              return { kind: "ok" }
            },
          },
        },
        calls: () => [],
        after: virtualClock(0).after,
      }),
    }
    await runEffectScenarios(allRows(loadDomainFiles()), [run])
    return args
  }

  test("#given a call with no options and no abort #then the member gets its input alone", async () => {
    expect(await seen(scenario("by-id", undefined))).toEqual([{ thread: "t1" }])
  })

  test("#given stated options #then they are the second argument, with the signal only when the scenario aborts", async () => {
    const [, options] = await seen({ ...scenario("by-id", undefined), options: { deadline_ms: 20 } })
    expect(options).toEqual({ deadline_ms: 20 })
    const [, aborting] = await seen({
      ...scenario("by-id", undefined),
      options: { deadline_ms: 20 },
      abort: { after_ms: 5 },
    })
    expect(Object.keys(Object(aborting)).toSorted()).toEqual(["deadline_ms", "signal"])
  })
})

describe("the virtual clock", () => {
  test("#given timers #when time advances #then the due ones fire in time order and the rest wait; none fires at 0 later", () => {
    const clock = virtualClock(1_000)
    const fired: string[] = []
    clock.after(30, () => fired.push("30"))
    clock.after(10, () => fired.push("10"))
    const cancel = clock.after(20, () => fired.push("20"))
    clock.after(0, () => fired.push("0"))
    cancel()
    clock.advance(25)
    expect([clock.now(), fired]).toEqual([1_025, ["0", "10"]])
    clock.advance(5)
    expect(fired).toEqual(["0", "10", "30"])
  })
})

describe("each thread control's wait scenarios over the real root (T1b)", () => {
  test("#given the table #then each of the six controls has a deadline row beside its caller-cancels row", () => {
    expect(waits.map((entry) => entry.id).toSorted()).toEqual(
      CONTROLS.flatMap((row) => [`${row}/caller-cancels`, `${row}/deadline-passes`])
        .concat("threads.rename/deadline-passes-after-write")
        .toSorted(),
    )
  })

  test.each(waits.map((entry) => entry.id))("#given %s #then it passes", async (id) => {
    expect(await judged(of(id))).toEqual([])
  })

  test.each(CONTROLS.map((row) => `${row}/deadline-passes`))(
    "#given %s expected as succeeding #then the fired deadline's timeout fails it",
    async (id) => {
      const stated = of(id)
      const { refusal: _dropped, ...succeeding } = stated
      expect(await judged({ ...succeeding, kind: "effect" })).toContainEqual(
        `row ${stated.row}: scenario ${id} answered timeout where an effect was expected`,
      )
      const answered = await judged({ ...stated, refusal: "cancelled" })
      expect(answered).toContainEqual(`row ${stated.row}: scenario ${id} answered timeout, not the refusal cancelled`)
    },
  )

  test("#given the deadline rows with their port calls taking no time #then the deadline never fires and they fail", async () => {
    for (const id of ["threads.rename/deadline-passes", "threads.rename/deadline-passes-after-write"]) {
      const stated = of(id)
      const instant = { ...stated, expect: stated.expect.map(({ takes_ms: _dropped, ...rest }) => rest) }
      expect((await judged(instant)).length).toBeGreaterThan(0)
    }
  })
})
