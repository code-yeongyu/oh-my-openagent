import { describe, expect, test } from "bun:test"

import { baselineProblems, PIN_PATH } from "./baseline"
import { conformanceProblems, type EffectEvidence } from "./conformance"
import { type EffectScenario, runEffectScenarios } from "./conformance-run"
import { gateReport, goldenProblems } from "./gate"
import { input, original, rows, text, unresolved } from "./gate-fixture"
import type { Row } from "./schema"

// Negative controls of design 7.2, 7.3 and 7.6 for what builds a row (reviews 6061267823 H1/H3, 6061624223 H1): typed run
// evidence whose observed effect equals the scenario's expected one, every input covered, and the first gap closure.

describe("negative controls: goldens, evidence and the first closure (7.6, review 6061267823 H1, H3)", () => {
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

  const locate = rows.find((row) => row.id === "threads.locate")
  if (locate === undefined) throw new Error("no threads.locate row")
  const built: Row = { ...locate, today: "yes", scenarios: { effect: ["locate-by-id"], refusal: [] } }
  const builtRows = rows.map((row) => (row.id === "threads.locate" ? built : row))
  const open = new Set(unresolved.entries.map((entry) => entry.id).filter((id) => id !== "threads.locate"))
  const fakeRoot = (answer: unknown, overrides: Partial<EffectScenario> = {}): EffectScenario => {
    const seen: unknown[] = []
    return {
      id: "locate-by-id",
      capability: "threads.locate",
      input: { thread: "t1", all_scope: true },
      covers: ["thread", "all_scope"],
      expected: { thread: "t1", all_scope: true },
      setup: () => ({
        root: { threads: { locate: (input: unknown) => (seen.push(input), answer) } },
        port: "host.listSessions",
        observe: () => seen[0],
      }),
      ...overrides,
    }
  }

  test("#given a stub answering not_implemented on a row counted as built #then it is named", async () => {
    const evidence = await runEffectScenarios(builtRows, [
      fakeRoot({ kind: "error", error: { code: "not_implemented" } }),
    ])
    expect(conformanceProblems(builtRows, open, evidence)).toContainEqual(
      "row threads.locate: scenario locate-by-id answered not_implemented; threads.locate is a stub, build it",
    )
  })

  test("#given a row whose only scenario is a refusal #then it is not counted as built", () => {
    const refusalOnly = builtRows.map((row) =>
      row.id === "threads.locate" ? { ...built, scenarios: { effect: [], refusal: ["locate-missing"] } } : row,
    )
    expect(conformanceProblems(refusalOnly, open, [])).toEqual([
      "row threads.locate's only scenarios are refusals; add an effect scenario for each input of threads.locate",
    ])
  })

  test("#given a record whose member is not the row's call #then the evidence does not build the row", () => {
    const wrong: EffectEvidence = {
      scenario: "locate-by-id",
      capability: "threads.locate",
      member: "threads.list",
      input: {},
      covers: ["thread", "all_scope"],
      status: "passed",
      effect: { port: "p", observed: 1, expected: 1 },
    }
    expect(conformanceProblems(builtRows, open, [wrong])).toContainEqual(
      "row threads.locate: scenario locate-by-id ran threads.list for threads.locate, not threads.locate",
    )
  })

  test("#given a run whose observed effect is not the scenario's expected one #then it does not build the row (review 6061624223 H1)", async () => {
    const evidence = await runEffectScenarios(builtRows, [
      fakeRoot({ kind: "ok" }, { expected: { thread: "t2", all_scope: true } }),
    ])
    expect(conformanceProblems(builtRows, open, evidence)).toContainEqual(
      'row threads.locate: scenario locate-by-id observed {"thread":"t1","all_scope":true} on host.listSessions, not the expected {"thread":"t2","all_scope":true}',
    )
  })

  test("#given passing evidence that covers only some inputs #then each uncovered input is named", async () => {
    const evidence = await runEffectScenarios(builtRows, [
      fakeRoot({ kind: "ok" }, { input: { thread: "t1" }, covers: ["thread"], expected: { thread: "t1" } }),
    ])
    expect(conformanceProblems(builtRows, open, evidence)).toEqual([
      "row threads.locate: input all_scope has no passing effect scenario; add one that covers it",
    ])
  })

  test("#given the first correct closure of a gap with evidence matching every input's expected effect #then the baseline admits it (positive control)", async () => {
    const evidence = await runEffectScenarios(builtRows, [fakeRoot({ kind: "ok", thread: "t1" })])
    expect(evidence).toEqual([
      {
        scenario: "locate-by-id",
        capability: "threads.locate",
        member: "threads.locate",
        input: { thread: "t1", all_scope: true },
        covers: ["thread", "all_scope"],
        status: "passed",
        effect: {
          port: "host.listSessions",
          observed: { thread: "t1", all_scope: true },
          expected: { thread: "t1", all_scope: true },
        },
      },
    ])
    const cleared = { ...unresolved, entries: unresolved.entries.filter((entry) => entry.id !== "threads.locate") }
    const state = {
      rows: builtRows,
      originalText: original,
      pinText: text(PIN_PATH),
      unresolved: cleared,
      evidence,
      atBase: { originalText: original, pinText: text(PIN_PATH), unresolved },
    }
    expect(baselineProblems(state)).toEqual([])
    expect(conformanceProblems(builtRows, open, evidence)).toEqual([])
  })

  test("#given the initializing pull request (the base has no record) #then the original, its pin and the manifest are admitted together", () => {
    const state = {
      rows,
      originalText: original,
      pinText: text(PIN_PATH),
      unresolved,
      evidence: [],
      atBase: { originalText: undefined, pinText: undefined, unresolved: undefined },
    }
    expect(baselineProblems(state)).toEqual([])
  })
})
