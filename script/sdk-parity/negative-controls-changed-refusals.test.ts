import { describe, expect, test } from "bun:test"

import { type ChangedRefusal, loadChangedRefusals, unknownFieldCoverageProblems } from "./changed-refusals"
import { gateReport } from "./gate"
import { input, rows, unresolved } from "./gate-fixture"
import type { Outcome } from "./scenario-run"
import { SCENARIOS, type Scenario } from "./scenarios"
import { withoutAhead } from "./tool-ahead-fixture"

// Negative controls of design 7.6 for the declared changed-refusal list (LEAD ruling on #15076): each breaks one condition
// and must fail, measured against the admitted change.

const refusal = (next: string, code = "invalid_arguments", message = 'This tool takes no field "unknown_field"') => ({
  result: { kind: "error", error: { code, message, next_action: next } },
})
const unknownClose = SCENARIOS.find((scenario) => scenario.id === "unknown-field-thread_close") as Scenario
const entry: ChangedRefusal = { scenario: unknownClose.id, pr: "#15076", reason: "new next_action" }
const judge = (
  before: Outcome,
  after: Outcome,
  refusals: { base?: readonly ChangedRefusal[]; head: readonly ChangedRefusal[] } = { head: [entry] },
  scenario: Scenario = unknownClose,
) =>
  gateReport(
    input({
      scenarios: [scenario],
      base: { ...input().base, outcomes: { [scenario.id]: before } },
      head: { ...input().head, outcomes: { [scenario.id]: after } },
      changedRefusals: { base: refusals.base ?? [], head: refusals.head },
    }),
  )
const failing = (report: ReturnType<typeof gateReport>) =>
  report.failures.filter((line) => line.includes(unknownClose.id))

describe("negative controls: the changed-refusal list", () => {
  test("#given only next_action changed under an entry added in this pull request #then it is admitted and reported", () => {
    const report = judge(refusal("old advice"), refusal("new advice"))
    expect(failing(report)).toEqual([])
    expect(report.changedRefusals).toEqual([`${unknownClose.id}#changed-refusal`])
  })

  test.each([
    ["its message changes", refusal("new", "invalid_arguments", "another message")],
    ["its code changes", refusal("new", "not_found")],
    ["it becomes an acceptance", { result: { kind: "ok" } }],
    [
      "its error gains another key",
      { result: { kind: "error", error: { ...refusal("new").result.error, kind: "error" } } },
    ],
    ["its result gains another key", { result: { ...refusal("new").result, device: "d1" } }],
    ["the outcome gains another key", { ...refusal("new"), threw: "boom" }],
  ])("#given a declared refusal where %s #then it fails", (_how, after) => {
    expect(failing(judge(refusal("old"), after))[0]).toContain("is declared in script/sdk-parity/changed-refusals.json")
  })

  test("#given the entry already on the merge base #then it admits nothing", () => {
    expect(failing(judge(refusal("old"), refusal("new"), { base: [entry], head: [entry] }))[0]).toContain(
      "answers differently on the merge base and the head",
    )
  })

  test("#given an entry for a refusal that did not change #then it fails as stale", () => {
    expect(failing(judge(refusal("same"), refusal("same")))[0]).toContain("answers the same on both trees")
  })

  test("#given an entry naming a scenario that does not exist #then it fails", () => {
    const report = judge(refusal("old"), refusal("new"), { head: [entry, { ...entry, scenario: "no-such-scenario" }] })
    expect(report.failures).toContainEqual(
      expect.stringContaining("names scenario no-such-scenario, which does not exist"),
    )
  })

  test("#given each generated unknown-field scenario whose entry is removed #then that scenario fails", () => {
    const committed = loadChangedRefusals()
    const generated = SCENARIOS.filter((scenario) => scenario.surface === "tool" && scenario.unknownField === true)
    expect(generated.map((scenario) => scenario.id).toSorted()).toEqual(
      committed
        .filter((declared) => declared.bound === undefined)
        .map((declared) => declared.scenario)
        .toSorted(),
    )
    for (const scenario of generated) {
      const others = committed.filter((declared) => declared.scenario !== scenario.id)
      const report = judge(refusal("old"), refusal("new"), { head: others }, scenario)
      expect(report.failures).toContainEqual(expect.stringContaining(`scenario ${scenario.id} answers differently`))
    }
  })

  test("#given a thread tool without its unknown-field scenario #then coverage fails", () => {
    expect(unknownFieldCoverageProblems(rows, SCENARIOS)).toEqual([])
    const without = SCENARIOS.filter((scenario) => scenario.id !== "unknown-field-thread_archive")
    expect(unknownFieldCoverageProblems(rows, without)).toEqual([
      "tool thread_archive has no unknown-field scenario; it is generated from the rows (scenarios.ts)",
    ])
  })
})

describe("negative controls: a bound entry", () => {
  const below = SCENARIOS.find((scenario) => scenario.id === "tool-read-wait-below-bound") as Scenario
  const bound: ChangedRefusal = {
    scenario: below.id,
    pr: "#15076",
    reason: "bound",
    bound: { field: "wait_ms", from: 1, to: 0 },
  }
  const threw = (min: number, tail = "") => ({
    threw: `Validation failed for tool "thread_read":\n  - wait_ms: must be >= ${min}${tail}`,
  })
  const tools = (min: number) => [
    { name: "thread_read", parameters: { properties: { wait_ms: { type: "integer", minimum: min } } } },
  ]
  const run = (after: Outcome, options: { headMin?: number; widened?: boolean } = {}) =>
    gateReport(
      input({
        scenarios: [below],
        base: {
          ...input().base,
          tools: tools(1),
          outcomes: { [below.id]: threw(1) },
          unresolved: withoutAhead(unresolved.entries),
        },
        head: {
          ...input().head,
          tools: tools(options.headMin ?? 0),
          outcomes: { [below.id]: after },
          ...(options.widened === false ? { unresolved: withoutAhead(unresolved.entries) } : {}),
        },
        changedRefusals: { base: [], head: [bound] },
      }),
    ).failures.filter((line) => line.includes(below.id))

  test("#given only the widened bound moved in the message #then it is admitted", () => {
    expect(run(threw(0))).toEqual([])
  })

  test.each([
    ["any other message change", threw(0, " and something else"), {}],
    ["another outcome key beside the message", { ...threw(0), result: { kind: "ok" } }, {}],
    ["a minimum that did not move", threw(0), { headMin: 1 }],
    ["a row whose entry does not widen the field", threw(0), { widened: false }],
  ])("#given %s #then it fails", (_how, after, options) => {
    expect(run(after, options)).toHaveLength(1)
  })

  test("#given the real rows #then the bound scenario's row widens wait_ms", () => {
    expect(rows.some((row) => row.id === below.capability)).toBe(true)
    expect(unresolved.entries.find((entry) => entry.id === below.capability)?.toolAhead?.widened).toContain("wait_ms")
  })
})
