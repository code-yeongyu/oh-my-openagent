import { describe, expect, test } from "bun:test"

import { baselineProblems, PIN_PATH } from "./baseline"
import { conformanceProblems, type EffectEvidence } from "./conformance"
import { runEffectScenarios, type ScenarioRun } from "./conformance-run"
import { expectationProblems, type ObservedCall, portProblems, type TableScenario } from "./expectation"
import { built, builtRows, CONTEXT, open, pair, run, scenario } from "./conformance-fixture"
import { gateReport, goldenProblems } from "./gate"
import { input, original, rows, text, unresolved } from "./gate-fixture"

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
    expect(conformanceProblems(builtRows, open, evidence, CONTEXT)).toContainEqual(
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
    expect(conformanceProblems(builtRows, open, [wrong], CONTEXT)).toContainEqual(
      "row threads.locate: scenario threads.locate/by-id ran threads.list for threads.locate, not threads.locate",
    )
  })

  test("#given a run whose port calls do not match the expected effect #then it does not build the row (review 6061624223 H1)", async () => {
    const silent = run(scenario("by-id", undefined), { kind: "ok" }, () => ({ kind: "ok" }))
    const evidence = await runEffectScenarios(builtRows, [silent, ...pair.slice(1)])
    expect(conformanceProblems(builtRows, open, evidence, CONTEXT)).toContainEqual(
      'row threads.locate: scenario threads.locate/by-id: host.listSessions {"allScope":false} expected 1 call(s), observed 0',
    )
  })

  test("#given an optional input no pair of passing scenarios varies alone #then it is named", async () => {
    const onlyOne = builtRows.map((row) =>
      row.id === "threads.locate" ? { ...built, scenarios: { effect: ["threads.locate/by-id"], refusal: [] } } : row,
    )
    const evidence = await runEffectScenarios(onlyOne, [pair[0] as ScenarioRun])
    expect(conformanceProblems(onlyOne, open, evidence, CONTEXT)).toEqual([
      "row threads.locate: input all_scope has no pair of passing scenarios that differ in it alone; add one",
      "row threads.locate: no passing effect scenario addresses a thread on other_device; add one",
    ])
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
      evidence,
      context: CONTEXT,
      atBase: { originalText: original, pinText: text(PIN_PATH), unresolved },
    }
    expect(baselineProblems(state)).toEqual([])
    expect(conformanceProblems(builtRows, open, evidence, CONTEXT)).toEqual([])
  })

  test("#given the initializing pull request (the base has no record) #then the original, its pin and the manifest are admitted together", () => {
    const state = {
      rows,
      originalText: original,
      pinText: text(PIN_PATH),
      unresolved,
      evidence: [],
      context: CONTEXT,
      atBase: { originalText: undefined, pinText: undefined, unresolved: undefined },
    }
    expect(baselineProblems(state)).toEqual([])
  })
})
