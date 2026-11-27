import { describe, expect, test } from "bun:test"

import { conformanceProblems } from "./conformance"
import { built, CONTEXT, open, pair, run, scenario } from "./conformance-fixture"
import { runEffectScenarios, type ScenarioRun } from "./conformance-run"
import type { ObservedCall, TableScenario } from "./expectation"
import { rows } from "./gate-fixture"
import { tableProblems } from "./scenario-rules"
import { rowProblems, type Row } from "./schema"

// Negative controls for review 6062172318 and the design lane's rulings on round 5: every `then` step runs in order on
// the state the one before it left and must pass; an answer is a subset of the whole ok answer; a stream has exactly one
// well-formed terminal event, last; coverage compares effects with the matcher's semantics; a pure row touches nothing.

const host = (op: string, args: Record<string, unknown> = {}): ObservedCall => ({ port: "host", op, args })
const withLocate = (change: Partial<Row>): Row[] =>
  rows.map((row) => (row.id === "threads.locate" ? { ...built, ...change } : row))
const problems = async (runs: readonly ScenarioRun[], target: readonly Row[]) =>
  conformanceProblems(target, open, await runEffectScenarios(target, runs), CONTEXT)

describe("sequences: a retry after a lost acknowledgement (H1)", () => {
  // A fake host that opens a session once per key: the retry under the same key answers the first thread and opens none.
  const retry = (answerSecond: Record<string, unknown>): ScenarioRun => {
    const table: TableScenario = {
      ...scenario("by-id", undefined),
      expect: [{ port: "host", op: "kill", args: { key: "k1" } }],
      then: [
        {
          input: { thread: "t1" },
          kind: "effect",
          expect: [
            { port: "host", op: "kill", count: 0 },
            { port: "host", op: "listSessions" },
          ],
          answer: answerSecond,
        },
      ],
    }
    return {
      scenario: table,
      setup: () => {
        const calls: ObservedCall[] = []
        let opened: string | undefined
        const locate = () => {
          if (opened === undefined) {
            calls.push(host("kill", { key: "k1" }))
            opened = "t1"
          } else calls.push(host("listSessions"))
          return { kind: "ok", thread: opened, caller: "me" }
        }
        return { root: { threads: { locate } }, calls: () => calls }
      },
    }
  }
  const target = withLocate({
    scenarios: {
      effect: ["threads.locate/by-id", "threads.locate/all-scope", "threads.locate/other-device"],
      refusal: [],
    },
  })

  test("#given the second call answers the original thread and opens nothing #then the sequence passes, each step on its own trace", async () => {
    const [record] = await runEffectScenarios(target, [retry({ thread: "t1", caller: "me" })])
    expect(record?.observed).toEqual([host("kill", { key: "k1" })])
    expect(record?.steps?.map((step) => [step.scenario, step.observed])).toEqual([
      ["threads.locate/by-id#step2", [host("listSessions")]],
    ])
    expect(await problems([retry({ thread: "t1", caller: "me" }), ...pair.slice(1)], target)).not.toContainEqual(
      expect.stringContaining("by-id"),
    )
  })

  test("#given the second call answers another thread #then the scenario fails on that step", async () => {
    expect(await problems([retry({ thread: "t2" }), ...pair.slice(1)], target)).toContainEqual(
      'row threads.locate: scenario threads.locate/by-id#step2: answered {"kind":"ok","thread":"t1","caller":"me"}, not the expected {"thread":"t2"}',
    )
  })
})

describe("the success discriminator and step shapes (review 6062344773)", () => {
  test("#given an effect call that returns something other than a kind ok result #then it is not a success", async () => {
    const bare = run(scenario("by-id", undefined), undefined, (calls) => {
      calls.push(host("listSessions", { allScope: false }))
      return { thread: "t1" }
    })
    expect(await problems([bare, ...pair.slice(1)], withLocate({}))).toContainEqual(
      'row threads.locate: scenario threads.locate/by-id answered {"thread":"t1"}, not a successful result (kind "ok")',
    )
  })

  test("#given a then step that breaks the table's shape rules #then the table names the step", () => {
    const stepped: TableScenario = {
      ...scenario("by-id", undefined),
      then: [
        { input: {}, kind: "refusal", expect: [] },
        { input: {}, kind: "effect", refusal_from: "value", expect: [{ port: "host", op: "kill", count: 0 }] },
      ],
    }
    expect(
      tableProblems(withLocate({}), [
        stepped,
        scenario("all-scope", true),
        scenario("other-device", undefined, "other_device"),
      ]),
    ).toEqual([
      "scenario threads.locate/by-id step 2: a refusal scenario names its code",
      "scenario threads.locate/by-id step 3: refusal_from belongs to a refusal",
      "scenario threads.locate/by-id step 3: an effect scenario states a port effect; an answer alone builds nothing",
    ])
  })
})

describe("streams: exactly one well-formed terminal event, last (M2)", () => {
  const stream = (events: readonly unknown[]) => ({
    async *[Symbol.asyncIterator]() {
      yield* events
    },
  })
  const streamed = (events: readonly unknown[]) =>
    run(scenario("by-id", undefined), undefined, (calls) => {
      calls.push(host("listSessions", { allScope: false }))
      return stream(events)
    })
  const named = async (events: readonly unknown[]) =>
    (await problems([streamed(events), ...pair.slice(1)], withLocate({})))[0]

  test("#given a terminal event with no payload, or two payloads #then each is malformed", async () => {
    expect(await named([{ kind: "end" }])).toBe(
      "row threads.locate: scenario threads.locate/by-id threw the terminal event carries none of outcome, failure, cancelled",
    )
    expect(await named([{ kind: "end", outcome: 1, failure: { code: "x" } }])).toBe(
      "row threads.locate: scenario threads.locate/by-id threw the terminal event carries outcome and failure of outcome, failure, cancelled",
    )
  })

  test("#given an event after the terminal event, or two terminal events #then the stream is broken", async () => {
    expect(
      await named([
        { kind: "end", outcome: 1 },
        { kind: "event", event: 2 },
      ]),
    ).toBe("row threads.locate: scenario threads.locate/by-id threw the stream sent an event after its terminal event")
    expect(
      await named([
        { kind: "end", outcome: 1 },
        { kind: "end", outcome: 2 },
      ]),
    ).toBe("row threads.locate: scenario threads.locate/by-id threw the stream sent 2 terminal events")
  })
})

describe("coverage compares effects with the matcher's semantics (M3)", () => {
  test("#given two scenarios whose effects differ only in order, an explicit count of 1 and key order #then they do not cover the input", async () => {
    const effect = (
      id: string,
      scopeAll: boolean,
      expectations: TableScenario["expect"],
      target: "this_device" | "other_device" = "this_device",
    ) => {
      const table: TableScenario = { ...scenario(id, scopeAll, target), expect: expectations }
      return run(table, undefined, (calls) => {
        calls.push(host("listSessions", { a: 1, b: 2 }), host("kill", {}))
        return { kind: "ok" }
      })
    }
    const runs = [
      effect("by-id", false, [
        { port: "host", op: "listSessions", args: { a: 1, b: 2 } },
        { port: "host", op: "kill" },
      ]),
      effect("all-scope", true, [
        { op: "kill", port: "host", count: 1 },
        { port: "host", op: "listSessions", args: { b: 2, a: 1 } },
      ]),
      effect(
        "other-device",
        true,
        [
          { port: "host", op: "kill" },
          { port: "host", op: "listSessions", args: { a: 1, b: 2 } },
        ],
        "other_device",
      ),
    ]
    expect(await problems(runs, withLocate({}))).toEqual([
      "row threads.locate: input all_scope has no pair of passing scenarios that differ in it alone; add one",
    ])
  })
})

describe("pure rows (design lane ruling on 7.3)", () => {
  const help = rows.find((row) => row.id === "toolkit.help")
  if (help === undefined) throw new Error("no toolkit.help row")
  const helpBuilt: Row = { ...help, today: "yes", scenarios: { effect: ["toolkit.help/usage"], refusal: [] } }
  const target = rows.map((row) => (row.id === "toolkit.help" ? helpBuilt : row))
  // The fake records, during the call, the port operations the member performs (here: `touches`).
  const usage = (touches: readonly ObservedCall[]): ScenarioRun => ({
    scenario: {
      id: "toolkit.help/usage",
      row: "toolkit.help",
      kind: "effect",
      input: {},
      expect: [],
      answer: { value: { usage: "u" } },
    },
    setup: () => {
      const calls: ObservedCall[] = []
      const help = () => {
        calls.push(...touches)
        return { kind: "ok", value: { usage: "u" } }
      }
      return { root: { toolkit: { help } }, calls: () => calls }
    },
  })
  const helpOpen = new Set([...open].filter((id) => id !== "toolkit.help"))
  const helpProblems = async (calls: readonly ObservedCall[]) =>
    conformanceProblems(target, helpOpen, await runEffectScenarios(target, [usage(calls)]), {
      effects: { ...CONTEXT.effects, store: [] },
    }).filter((problem) => problem.startsWith("row toolkit.help"))

  test("#given a pure call that answers and touches nothing #then it is built", async () => {
    expect(await helpProblems([])).toEqual([])
  })

  test("#given a pure call whose fake records one read #then it fails", async () => {
    expect(await helpProblems([{ port: "store", op: "read", args: {} }])).toEqual([
      "row toolkit.help: scenario toolkit.help/usage: a pure call touched store.read; it must touch nothing",
      "row toolkit.help has no passing effect scenario",
    ])
  })

  test("#given pure on a row outside the closed list #then the schema refuses it", () => {
    expect(rowProblems({ ...built, pure: true, pureReason: "x" })).toContainEqual(
      "row threads.locate: only account.signInCheck, toolkit.help may declare pure; this row touches a port and states it",
    )
  })
})
