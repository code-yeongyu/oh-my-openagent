import { describe, expect, test } from "bun:test"

import { conformanceProblems } from "./conformance"
import { built, builtRows, CONTEXT, open, pair, run, scenario } from "./conformance-fixture"
import { runEffectScenarios, type ScenarioRun } from "./conformance-run"
import type { ObservedCall, TableScenario } from "./expectation"
import { rows } from "./gate-fixture"
import { tableProblems } from "./scenario-rules"
import { rowProblems, type Row } from "./schema"

// Negative controls for review 6061874518 H1, H2, M3 and the design lane's rulings on the scenario table: a complete
// trace of effect operations, the effect/refusal split, an answer that never replaces an effect, a refusal read where
// the scenario says, the stream terminal, the virtual-clock abort, and a table valid apart from a row being built.

const problems = async (runs: readonly ScenarioRun[], target: readonly Row[] = builtRows) =>
  conformanceProblems(target, open, await runEffectScenarios(target, runs), CONTEXT)
const withLocate = (change: Partial<Row>): Row[] =>
  rows.map((row) => (row.id === "threads.locate" ? { ...built, ...change } : row))
const custom = (table: TableScenario, member: (calls: ObservedCall[], input: unknown) => unknown): ScenarioRun =>
  run(table, undefined, member)
const host = (op: string, args: Record<string, unknown> = {}): ObservedCall => ({ port: "host", op, args })

describe("conformance: the observed trace and the stated effect (H1)", () => {
  test("#given a run that also performs an effect operation the scenario does not state #then it fails", async () => {
    const extra = custom(scenario("by-id", undefined), (calls) => {
      calls.push(host("listSessions", { allScope: false }), host("kill", { pid: 7 }))
      return { kind: "ok" }
    })
    expect(await problems([extra, ...pair.slice(1)])).toContainEqual(
      'row threads.locate: scenario threads.locate/by-id: effect host.kill {"pid":7} happened but the scenario does not state it',
    )
  })

  test("#given an operation on a port the effect table does not classify #then it fails closed", async () => {
    const unknown = custom(scenario("by-id", undefined), (calls) => {
      calls.push(host("listSessions", { allScope: false }), { port: "vault", op: "read", args: {} })
      return { kind: "ok" }
    })
    expect(await problems([unknown, ...pair.slice(1)])).toContainEqual(
      "row threads.locate: scenario threads.locate/by-id: port vault has no effect classification; the effect table passed in must name every port",
    )
  })

  test("#given two scenarios that differ in an input and only in the fakes' stimulus #then they do not cover that input", async () => {
    const stimulus = (
      id: string,
      scopeAll: boolean,
      result: number,
      target: "this_device" | "other_device" = "this_device",
    ): TableScenario => ({
      ...scenario(id, scopeAll, target),
      expect: [{ port: "host", op: "listSessions", result }],
    })
    const runs = [
      custom(stimulus("by-id", false, 1), (calls) => {
        calls.push(host("listSessions"))
        return { kind: "ok" }
      }),
      custom(stimulus("all-scope", true, 2), (calls) => {
        calls.push(host("listSessions"))
        return { kind: "ok" }
      }),
      custom(stimulus("other-device", true, 3, "other_device"), (calls) => {
        calls.push(host("listSessions"))
        return { kind: "ok" }
      }),
    ]
    expect(await problems(runs)).toEqual([
      "row threads.locate: input all_scope has no pair of passing scenarios that differ in it alone; add one",
    ])
  })
})

describe("conformance: the row's split and the answer (H2)", () => {
  test("#given a refusal record listed under the row's effects #then the split names it", async () => {
    const refusal: TableScenario = { ...scenario("by-id", undefined), kind: "refusal", refusal: "not_found" }
    const runs = [run(refusal, { kind: "error", error: { code: "not_found" } }), ...pair.slice(1)]
    expect(await problems(runs)).toContainEqual(
      "row threads.locate: scenario threads.locate/by-id is a refusal scenario but the row lists it under effect",
    )
  })

  test("#given an effect scenario whose only assertion is the answer #then it does not build the row", async () => {
    const answerOnly: TableScenario = {
      ...scenario("by-id", undefined),
      expect: [{ port: "host", op: "kill", count: 0 }],
      answer: { value: { found: true } },
    }
    const runs = [custom(answerOnly, () => ({ kind: "ok", value: { found: true } })), ...pair.slice(1)]
    expect(await problems(runs)).toContainEqual(
      "row threads.locate: scenario threads.locate/by-id states no port effect; an answer alone does not build a row",
    )
  })

  test("#given a stated answer the call does not give #then it fails, in addition to the port expectations", async () => {
    const answered: TableScenario = { ...scenario("by-id", undefined), answer: { thread: "t1" } }
    const runs = [run(answered, { kind: "ok", thread: "t9" }), ...pair.slice(1)]
    expect(await problems(runs)).toContainEqual(
      'row threads.locate: scenario threads.locate/by-id: answered {"kind":"ok","thread":"t9"}, not the expected {"thread":"t1"}',
    )
  })

  test("#given a refusal stated in the value but answered as a root failure #then the source is named", async () => {
    const release: Row = {
      ...built,
      scenarios: { effect: built.scenarios.effect, refusal: ["threads.locate/other-refused"] },
    }
    const fromValue: TableScenario = {
      ...scenario("other-refused", undefined, "other_device"),
      kind: "refusal",
      refusal: "release_unsupported",
      refusal_from: "value",
      expect: [{ port: "host", op: "kill", count: 0 }],
    }
    const target = withLocate(release)
    const rooted = await problems(
      [...pair, run(fromValue, { kind: "error", error: { code: "release_unsupported" } })],
      target,
    )
    expect(rooted).toContainEqual(
      "row threads.locate: scenario threads.locate/other-refused read its refusal from the root, not the value it states",
    )
    const valued = await problems(
      [...pair, run(fromValue, { kind: "ok", value: { success: false, error: "release_unsupported" } })],
      target,
    )
    expect(valued).toEqual([])
  })
})

describe("conformance: streams and the caller's signal (M3)", () => {
  const stream = (events: readonly unknown[]) => ({
    async *[Symbol.asyncIterator]() {
      yield* events
    },
  })

  test("#given a stream ending in its outcome #then the run passes on that outcome and the observed calls", async () => {
    const streamed = custom(scenario("by-id", undefined), (calls) => {
      calls.push(host("listSessions", { allScope: false }))
      return stream([
        { kind: "event", event: 1 },
        { kind: "end", outcome: { done: true } },
      ])
    })
    expect(await problems([streamed, ...pair.slice(1)])).toEqual([])
  })

  test("#given a stream that ends with no terminal event #then the run fails", async () => {
    const open = custom(scenario("by-id", undefined), (calls) => {
      calls.push(host("listSessions", { allScope: false }))
      return stream([{ kind: "event", event: 1 }])
    })
    expect(await problems([open, ...pair.slice(1)])).toContainEqual(
      "row threads.locate: scenario threads.locate/by-id threw the stream ended with no terminal event",
    )
  })

  test("#given an abort after 50 ms of virtual time #then the member sees the signal and the cancelled refusal is read", async () => {
    const aborting: TableScenario = {
      ...scenario("by-id", undefined),
      kind: "refusal",
      refusal: "cancelled",
      abort: { after_ms: 50 },
      expect: [{ port: "host", op: "kill", count: 0 }],
    }
    let fire: (() => void) | undefined
    const runs: ScenarioRun[] = [
      {
        scenario: aborting,
        setup: () => ({
          root: {
            threads: {
              locate: (_input: unknown, options: { signal: AbortSignal }) => {
                fire?.()
                return stream(
                  options.signal.aborted ? [{ kind: "end", cancelled: true }] : [{ kind: "end", outcome: {} }],
                )
              },
            },
          },
          calls: () => [],
          after: (ms, callback) => {
            if (ms === 50) fire = callback
          },
        }),
      },
    ]
    const target = withLocate({ scenarios: { effect: [], refusal: ["threads.locate/by-id"] } })
    const [record] = await runEffectScenarios(target, runs)
    expect([record?.code, record?.codeSource]).toEqual(["cancelled", "root"])
  })
})

describe("the scenario table, valid apart from a row being built (design lane ruling on 7.3)", () => {
  const table = (extra: Partial<TableScenario>[] = []): TableScenario[] => [
    scenario("by-id", undefined),
    scenario("all-scope", true),
    scenario("other-device", undefined, "other_device"),
    ...extra.map((override) => ({ ...scenario("extra", undefined), ...override })),
  ]

  test("#given a thread row with no effect scenario on another device #then the table is invalid", () => {
    const missing = table().filter((entry) => entry.target !== "other_device")
    const target = withLocate({
      scenarios: { effect: ["threads.locate/by-id", "threads.locate/all-scope"], refusal: [] },
    })
    expect(tableProblems(target, missing)).toEqual([
      "row threads.locate: the table has no effect scenario on other_device; write the target contract, even before it can pass",
    ])
  })

  test("#given the other-device effect scenario present but failing #then the table is valid and the row is not built", async () => {
    expect(tableProblems(builtRows, table())).toEqual([])
    const failing = custom(scenario("other-device", undefined, "other_device"), () => ({
      kind: "error",
      error: { code: "local_only" },
    }))
    expect(await problems([...pair.slice(0, 2), failing])).toContainEqual(
      "row threads.locate: no passing effect scenario addresses a thread on other_device; add one",
    )
  })

  test("#given an aborting scenario that states no effect that must not happen #then the table names it", () => {
    expect(tableProblems(builtRows, table([{ abort: { after_ms: 10 } }]))).toContainEqual(
      "scenario threads.locate/extra: an aborting scenario states with count 0 the effect that must not have happened",
    )
  })

  test("#given addressScope on a row outside the closed host-local list #then the schema refuses it", () => {
    expect(rowProblems({ ...built, addressScope: "this_device", addressReason: "x" })).toContainEqual(
      "row threads.locate: only threads.adopt, threads.release, threads.unload may declare addressScope; this row addresses threads on every device",
    )
  })
})
