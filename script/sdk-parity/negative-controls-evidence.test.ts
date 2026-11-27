import { describe, expect, test } from "bun:test"

import { baselineProblems, PIN_PATH } from "./baseline"
import { conformanceProblems, type EffectEvidence } from "./conformance"
import { runEffectScenarios, type ScenarioRun } from "./conformance-run"
import { expectationProblems, type ObservedCall, portProblems, type TableScenario } from "./expectation"
import { built, builtRows, CONTEXT, open, pair, run, scenario, headEvidence } from "./conformance-fixture"
import { gateReport, goldenProblems } from "./gate"
import { filledRows, input, original, rows, text, unresolved } from "./gate-fixture"

// Negative controls of design 7.2, 7.3 and 7.6 for what builds a row (reviews 6061267823 H1/H3, 6061624223 H1, amendment
// 5): typed run evidence whose observed port calls match the scenario's expected effect, every optional input covered by
// a pair of scenarios that differ in it alone, and the first gap closure.

describe("negative controls: goldens, evidence and the first closure (7.6)", () => {
  test("#given a stored golden edited with the behaviour unchanged #then it differs from the live outcome", () => {
    expect(goldenProblems({ s1: { exit: 3 } }, { s1: { exit: 2 } })).toEqual([
      "goldens.json s1 differs from the scenario's live outcome; regenerate with bun script/sdk-parity/scenario-run.ts --out script/sdk-parity/goldens.json",
    ])
  })

  test("#given a scenario with no outcome at the head #then the gate fails on it instead of skipping it", () => {
    expect(gateReport(input({ head: { ...input().head, outcomes: {} } })).failures).toEqual([
      "threads.send: scenario s1 has no outcome at the head; the runner did not run it",
    ])
  })

  test("#given a stub answering not_implemented on a row counted as built #then it is named", async () => {
    const evidence = await runEffectScenarios(builtRows, [
      run(scenario("by-id", undefined), { kind: "error", error: { code: "not_implemented" } }),
      pair[1] as ScenarioRun,
    ])
    expect(conformanceProblems(builtRows, open, [...(await headEvidence()), ...evidence], CONTEXT)).toContainEqual(
      "row threads.locate: scenario threads.locate/by-id answered not_implemented; threads.locate is a stub, build it",
    )
  })

  test("#given a row whose only scenario is a refusal #then it is not counted as built", () => {
    const refusalOnly = builtRows.map((row) =>
      row.id === "threads.locate" ? { ...built, scenarios: { effect: [], refusal: ["threads.locate/missing"] } } : row,
    )
    expect(conformanceProblems(refusalOnly, open, [], CONTEXT)).toContainEqual(
      "row threads.locate's only scenarios are refusals; add an effect scenario for each input of threads.locate",
    )
  })

  test("#given a record whose member is not the row's call #then the evidence does not build the row", async () => {
    const [first] = await runEffectScenarios(builtRows, [pair[0] as ScenarioRun])
    if (first === undefined) throw new Error("no record")
    const wrong: EffectEvidence = { ...first, member: "threads.list" }
    expect(conformanceProblems(builtRows, open, [...(await headEvidence()), ...[wrong]], CONTEXT)).toContainEqual(
      "row threads.locate: scenario threads.locate/by-id ran threads.list for threads.locate, not threads.locate",
    )
  })

  test("#given a run whose port calls do not match the expected effect #then it does not build the row (review 6061624223 H1)", async () => {
    const silent = run(scenario("by-id", undefined), { kind: "ok" }, () => ({ kind: "ok" }))
    const evidence = await runEffectScenarios(builtRows, [silent, ...pair.slice(1)])
    expect(conformanceProblems(builtRows, open, [...(await headEvidence()), ...evidence], CONTEXT)).toContainEqual(
      'row threads.locate: scenario threads.locate/by-id: host.listSessions {"allScope":false} expected 1 call(s), observed 0',
    )
  })

  test("#given an optional input no pair of passing scenarios varies alone #then it is named", async () => {
    const onlyOne = builtRows.map((row) =>
      row.id === "threads.locate" ? { ...built, scenarios: { effect: ["threads.locate/by-id"], refusal: [] } } : row,
    )
    const evidence = await runEffectScenarios(onlyOne, [pair[0] as ScenarioRun])
    expect(conformanceProblems(onlyOne, open, [...(await headEvidence()), ...evidence], CONTEXT)).toEqual([
      "row threads.locate: input all_scope has no pair of passing scenarios that differ in it alone; add one",
      "row threads.locate: no passing effect scenario addresses a thread on other_device; add one",
    ])
  })

  // Design lane ruling: a pair proves an input's effect by a different trace OR a different answer, from the same given.
  test("#given a pair with the same trace #when their stated answers differ, are equal, or their given state differs #then only the different answers cover the input", async () => {
    const evidence = await runEffectScenarios(builtRows, pair)
    const [a, b] = evidence
    if (a === undefined || b === undefined) throw new Error("no pair")
    type Answer = Readonly<Record<string, unknown>>
    const stated = (value: Answer) => ({ answer: { value }, answered: { kind: "ok", value } })
    const sameTrace = (answerA: Answer, answerB: Answer, givenB: readonly unknown[] = []): EffectEvidence[] => [
      { ...a, ...stated(answerA) },
      { ...b, expect: a.expect, observed: a.observed, ...stated(answerB), given: givenB },
    ]
    const uncovered =
      "row threads.locate: input all_scope has no pair of passing scenarios that differ in it alone; add one"
    const head = await headEvidence()
    const problems = (records: EffectEvidence[]) => conformanceProblems(builtRows, open, [...head, ...records], CONTEXT)
    expect(problems(sameTrace({ thread: "t-1" }, { thread: "t-2" }))).not.toContain(uncovered)
    expect(problems(sameTrace({ thread: "t-1" }, { thread: "t-1" }))).toContain(uncovered)
    expect(
      problems(sameTrace({ thread: "t-1" }, { thread: "t-2" }, [{ port: "host", state: { moved: true } }])),
    ).toContain(uncovered)
    const [setupA, setupB] = sameTrace({ thread: "t-1" }, { thread: "t-2" })
    if (setupA === undefined || setupB === undefined) throw new Error("no pair")
    expect(problems([setupA, { ...setupB, setup: { before: [{ row: "threads.create" }] } }])).toContain(uncovered)
    // A callbacks entry keyed by the input that differs is part of the difference; any other callbacks entry is fixture.
    const [cbA, cbB] = sameTrace({ thread: "t-1" }, { thread: "t-2" })
    if (cbA === undefined || cbB === undefined) throw new Error("no pair")
    expect(problems([cbA, { ...cbB, setup: { callbacks: { all_scope: "answers yes" } } }])).not.toContain(uncovered)
    expect(problems([cbA, { ...cbB, setup: { callbacks: { other: "answers yes" } } }])).toContain(uncovered)
    const [answeredA, silentB] = sameTrace({ thread: "t-1" }, { thread: "t-2" })
    if (answeredA === undefined || silentB === undefined) throw new Error("no pair")
    const { answer: _dropped, ...withoutAnswer } = silentB
    expect(problems([answeredA, withoutAnswer])).toContain(uncovered)
  })

  // Slices C1c and A1b rely on this for consent-style inputs: a refusal and an ok answer from the same given, differing in
  // one input, cover that input (the kinds differ); with a different given they do not.
  test("#given an ok scenario and a refusal scenario that differ in one input #when their given is the same #then the input is covered, and not when the given differs", async () => {
    const split = builtRows.map((row) =>
      row.id === "threads.locate"
        ? {
            ...built,
            scenarios: {
              effect: ["threads.locate/by-id", "threads.locate/other-device"],
              refusal: ["threads.locate/all-scope"],
            },
          }
        : row,
    )
    const refused = (given: readonly { readonly port: string; readonly state: Record<string, unknown> }[]) =>
      run(
        {
          ...scenario("all-scope", true),
          kind: "refusal",
          refusal: "scope_denied",
          ...(given.length === 0 ? {} : { given }),
        },
        { kind: "error", error: { code: "scope_denied" } },
      )
    const uncovered =
      "row threads.locate: input all_scope has no pair of passing scenarios that differ in it alone; add one"
    const problems = async (refusal: ScenarioRun) =>
      conformanceProblems(
        split,
        open,
        await runEffectScenarios(split, [pair[0], refusal, pair[2]] as ScenarioRun[]),
        CONTEXT,
      )
    expect(await problems(refused([]))).not.toContain(uncovered)
    expect(await problems(refused([{ port: "host", state: { moved: true } }]))).toContain(uncovered)
  })

  test("#given a scenario with before calls #when the runner records it #then its record carries them as its setup", async () => {
    const withBefore = {
      ...scenario("by-id", undefined),
      before: [{ row: "threads.create", input: {} }],
    } as TableScenario
    const [record] = await runEffectScenarios(builtRows, [run(withBefore)])
    expect(record?.setup).toEqual({ before: [{ row: "threads.create", input: {} }] })
    const [plain] = await runEffectScenarios(builtRows, [pair[0] as ScenarioRun])
    expect(plain?.setup).toBeUndefined()
  })

  test("#given a scenario whose answer carries a value generated per run #when it is run twice #then it fails by name and covers nothing", async () => {
    let generated = 0
    const unstable = run(
      { ...scenario("by-id", undefined), answer: { value: { thread: "t1" } } },
      undefined,
      (calls, input) => {
        calls.push({
          port: "host",
          op: "listSessions",
          args: { allScope: Reflect.get(Object(input), "all_scope") === true },
        })
        generated += 1
        return { kind: "ok", value: { thread: "t1", request: `r-${generated}` } }
      },
    )
    const steady = run(
      { ...scenario("by-id", undefined), answer: { value: { thread: "t1" } } },
      {
        kind: "ok",
        value: { thread: "t1", request: "r-1" },
      },
    )
    const [shaky] = await runEffectScenarios(builtRows, [unstable])
    const [stable] = await runEffectScenarios(builtRows, [steady])
    expect(shaky?.unstableAnswer).toBe(true)
    expect(stable?.unstableAnswer).toBeUndefined()
    expect(
      conformanceProblems(
        builtRows,
        open,
        [...(await headEvidence()), ...(shaky === undefined ? [] : [shaky])],
        CONTEXT,
      ),
    ).toContainEqual(
      "row threads.locate: scenario threads.locate/by-id: its answer differs between two runs of the same input; an unstable answer proves no effect",
    )
  })

  test("#given an evidence record #then it must state its given state (a producer cannot leave it absent)", async () => {
    const [record] = await runEffectScenarios(builtRows, [pair[0] as ScenarioRun])
    if (record === undefined) throw new Error("no record")
    expect(record.given).toEqual([])
    const { given: _given, ...withoutGiven } = record
    // @ts-expect-error given is required on every evidence record
    const absent: EffectEvidence = withoutGiven
    expect(absent.given).toBeUndefined()
  })

  test("#given a row resolved and filled by another slice #when no run carries its evidence #then it still fails by name (fixture scoping leaves no hole)", () => {
    const filled = builtRows.map((row) =>
      row.id === "devices.list" ? { ...row, scenarios: { effect: ["devices.list/plain"], refusal: [] } } : row,
    )
    const resolved = new Set([...open].filter((id) => id !== "devices.list"))
    expect(open.has("devices.list")).toBe(true)
    expect(conformanceProblems(filled, resolved, [], CONTEXT)).toContainEqual(
      "row devices.list: scenario devices.list/plain has no run record at the head",
    )
  })

  test("#given the matching rules #then args are a subset, count 0 means never, result is never compared", () => {
    const observed: ObservedCall[] = [{ port: "store", op: "read", args: { id: "a", extra: 1 } }]
    expect(
      expectationProblems([{ port: "store", op: "read", args: { id: "a" }, result: { anything: true } }], observed),
    ).toEqual([])
    expect(expectationProblems([{ port: "store", op: "write", count: 0 }], observed)).toEqual([])
    expect(expectationProblems([{ port: "store", op: "read", count: 0 }], observed)).toEqual([
      "store.read expected 0 call(s), observed 1",
    ])
    expect(portProblems([scenario("by-id", undefined)], { host: ["listSessions"] })).toEqual([])
    expect(portProblems([scenario("by-id", undefined)], { host: ["list"] })).toEqual([
      "scenario threads.locate/by-id expects host.listSessions, which is not a port operation",
    ])
    const faulty: TableScenario = {
      ...scenario("by-id", undefined),
      given: [{ port: "vault", state: {} }],
      fault: { port: "host", op: "kill", fault: "lost_reply" },
      then: [
        {
          input: {},
          kind: "effect",
          expect: [{ port: "host", op: "spawn" }],
          fault: { port: "clock", op: "listSessions", fault: "lost_reply" },
        },
      ],
    }
    expect(portProblems([faulty], { host: ["listSessions"], clock: ["listSessions"] })).toEqual([
      "scenario threads.locate/by-id expects host.spawn, which is not a port operation",
      "scenario threads.locate/by-id injects lost_reply on host.kill, which is not a port operation",
      "scenario threads.locate/by-id step 2 injects lost_reply on clock; it means something only on host, remote, store",
      "scenario threads.locate/by-id gives state to vault, which is not a port",
    ])
  })

  test("#given a lost reply on the gateway store's committed reservation (P1a's create recovery) #then it is a valid fault", () => {
    const recovery: TableScenario = {
      ...scenario("by-id", undefined),
      fault: { port: "store", op: "idempotency_put", fault: "lost_reply", occurrence: 2 },
    }
    expect(portProblems([recovery], { host: ["listSessions"], store: ["idempotency_put"] })).toEqual([])
  })

  test("#given the first correct closure of a gap with evidence matching every scenario #then the baseline admits it (positive control)", async () => {
    const evidence = await runEffectScenarios(builtRows, pair)
    expect(evidence.map((record) => [record.target, record.observed])).toEqual([
      ["this_device", [{ port: "host", op: "listSessions", args: { allScope: false, limit: 50 } }]],
      ["this_device", [{ port: "host", op: "listSessions", args: { allScope: true, limit: 50 } }]],
      ["other_device", [{ port: "host", op: "listSessions", args: { allScope: false, limit: 50 } }]],
    ])
    const cleared = { ...unresolved, entries: unresolved.entries.filter((entry) => entry.id !== "threads.locate") }
    const state = {
      rows: builtRows,
      originalText: original,
      pinText: text(PIN_PATH),
      unresolved: cleared,
      evidence: [...(await headEvidence()), ...evidence],
      context: CONTEXT,
      atBase: { originalText: original, pinText: text(PIN_PATH), unresolved },
    }
    expect(baselineProblems(state)).toEqual([])
    expect(conformanceProblems(builtRows, open, [...(await headEvidence()), ...evidence], CONTEXT)).toEqual([])
  })

  test("#given the initializing pull request (the base has no record) #then the original, its pin and the manifest are admitted together", async () => {
    const state = {
      rows,
      originalText: original,
      pinText: text(PIN_PATH),
      unresolved,
      evidence: await headEvidence(),
      context: CONTEXT,
      atBase: { originalText: undefined, pinText: undefined, unresolved: undefined },
    }
    expect(baselineProblems(state)).toEqual([])
  })
})

// The rows the tree really builds (scenario-fill-owners.json) are judged on their real run evidence; without it, or with a
// failing effect, the gate must name them (design lane ruling (1) on the first built row, condition (d)).
describe("a row the tree builds is judged on its own run evidence", () => {
  test("#given the built rows with no run record at the head #then each of their scenarios is named", () => {
    const problems = conformanceProblems(filledRows, open, [], CONTEXT)
    for (const row of filledRows)
      for (const id of row.scenarios.effect)
        expect(problems).toContain(`row ${row.id}: scenario ${id} has no run record at the head`)
    expect(filledRows.length).toBeGreaterThan(0)
  })

  test("#given a built row whose effect scenario observed nothing #then the row has no passing effect scenario", async () => {
    const head = await headEvidence()
    const broken = head.map((record) => (record.kind === "effect" ? { ...record, observed: [] } : record))
    const problems = conformanceProblems(filledRows, open, broken, CONTEXT)
    for (const row of filledRows) expect(problems).toContain(`row ${row.id} has no passing effect scenario`)
    expect(conformanceProblems(filledRows, open, head, CONTEXT)).toEqual([])
  })
})
