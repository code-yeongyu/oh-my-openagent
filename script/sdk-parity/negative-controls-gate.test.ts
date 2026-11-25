import { describe, expect, test } from "bun:test"
import { type Baseline, baselineProblems, PIN_PATH, sha256 } from "./baseline"
import { conformanceProblems, type EffectEvidence } from "./conformance"
import { runEffectScenarios, type EffectScenario } from "./conformance-run"
import { candidateDigest, gateReport, goldenProblems, renderReport } from "./gate"
import { HEAD, input, original, rows, text, unresolved } from "./gate-fixture"
import type { Row } from "./schema"

// Negative controls of design 7.6 for the baseline, the changed-capability gate (with the two tiers of amendment 2),
// the goldens and the conformance rule: each one breaks one thing and expects a message naming what to fix.

describe("negative controls: the changed-capability gate (7.6)", () => {
  test("#given a parser that answers differently with its descriptor untouched #then the capability fails", () => {
    const report = gateReport(input({ head: { ...input().head, outcomes: { s1: { exit: 0 } } } }))
    expect(report.failures).toEqual([
      "threads.send: scenario s1 answers differently on the merge base and the head; this pull request changes what it does without the SDK call threads.send",
    ])
  })

  test("#given a changed descriptor under an unresolved entry #then it fails, naming the SDK call to add", () => {
    const edited = rows.map((row): Row => (row.id === "threads.send" ? { ...row, slices: [...row.slices, "T2"] } : row))
    expect(gateReport(input({ head: { ...input().head, rows: edited } })).failures).toEqual([
      "threads.send: its descriptor changed under an unresolved gap; add the SDK call threads.send and its scenarios in this pull request",
    ])
  })

  test("#given a tool schema that changed under an unresolved entry #then it fails", () => {
    const tool = (maxLength: number) => [
      { name: "thread_send", parameters: { properties: { message: { type: "string", maxLength } } } },
    ]
    const report = gateReport(
      input({ base: { ...input().base, tools: tool(10) }, head: { ...input().head, tools: tool(20) } }),
    )
    expect(report.failures).toContainEqual(
      expect.stringContaining("threads.send: tool thread_send changed its input schema"),
    )
  })

  test("#given a core-only change under an unresolved entry, every descriptor, schema and outcome equal #then it is printed as a candidate with its digest, not failed", () => {
    const report = gateReport(input({ changedFiles: ["packages/omo-native/bin/lib/thread.js"] }))
    expect(report.failures).toEqual([])
    expect(report.candidates).toEqual(["threads.send"])
    const output = renderReport(report)
    expect(output).toContain(
      `SDK-Parity-Candidates: head=${HEAD} digest=${candidateDigest(HEAD, ["threads.send"])} count=1 ids=threads.send`,
    )
    expect(output).toContain("MISSING: the body needs the line `SDK-Parity-Unchanged: yes`")
    expect(
      gateReport(
        input({ changedFiles: ["packages/omo-native/bin/lib/thread.js"], body: "SDK-Parity-Unchanged: yes\n" }),
      ).unchangedLine,
    ).toBe(true)
  })

  test("#given a security-gated entry cleared without its slice line #then it fails, naming the slice", () => {
    const head = {
      ...input().head,
      unresolved: unresolved.entries.filter((entry) => entry.id !== "engine.trust.ensure"),
    }
    expect(gateReport(input({ head })).failures).toEqual([
      'engine.trust.ensure: only slice C1a clears this gap; name it with an "SDK-Parity-Slice: C1a" line or keep the entry',
    ])
    expect(gateReport(input({ head, body: "SDK-Parity-Slice: C1a\n" })).failures).toEqual([])
  })
})

describe("negative controls: the baseline (7.6)", () => {
  const atBase = { originalText: original, pinText: text(PIN_PATH), unresolved }
  const state = (manifest: Baseline, originalText = original, pinText = text(PIN_PATH)) => ({
    rows,
    originalText,
    pinText,
    unresolved: manifest,
    evidence: [] as readonly EffectEvidence[],
    atBase,
  })

  test("#given a row that names an effect scenario with no run record at the head #then it is not built and keeps its gap", () => {
    const named = rows.map((row): Row =>
      row.id === "threads.locate"
        ? { ...row, today: "yes", scenarios: { effect: ["locate-by-id"], refusal: [] } }
        : row,
    )
    const cleared = { ...unresolved, entries: unresolved.entries.filter((entry) => entry.id !== "threads.locate") }
    const problems = baselineProblems({
      ...state(cleared),
      rows: named,
      atBase: { ...atBase, unresolved },
      evidence: [] as readonly EffectEvidence[],
    })
    expect(problems).toContainEqual(
      expect.stringContaining("row threads.locate is not built and has no script/sdk-parity/unresolved.json entry"),
    )
  })

  test("#given an entry the original lacks #then it is refused, naming the call to build", () => {
    const added = {
      ...unresolved,
      entries: [...unresolved.entries, { id: "threads.teleport", gap: "x", slice: "T1b", issue: "new" }],
    }
    expect(baselineProblems(state(added))).toContainEqual(
      expect.stringContaining("lists threads.teleport, which script/sdk-parity/baseline.original.json lacks"),
    )
  })

  test("#given an entry the merge base had cleared #then restoring it is refused", () => {
    const cleared = { ...unresolved, entries: unresolved.entries.filter((entry) => entry.id !== "threads.archive") }
    const restored = baselineProblems({ ...state(unresolved), atBase: { ...atBase, unresolved: cleared } })
    expect(restored).toContainEqual(
      expect.stringContaining("restores threads.archive, which the merge base had cleared"),
    )
  })

  test("#given the original and its pin edited together #then the pin read from the merge base refuses both", () => {
    const edited = original.replace('"no SDK call"', '"no call"')
    const problems = baselineProblems(state(unresolved, edited, `${sha256(edited)}\n`))
    expect(problems).toContainEqual(expect.stringContaining("is written once and never changes"))
    expect(problems).toContainEqual(expect.stringContaining("does not match the pin read from the merge base"))
  })
})

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
  const fakeRoot = (answer: unknown): EffectScenario => {
    const seen: unknown[] = []
    return {
      id: "locate-by-id",
      capability: "threads.locate",
      input: { thread: "t1" },
      setup: () => ({
        root: { threads: { locate: (input: unknown) => (seen.push(input), answer) } },
        port: "host.listSessions",
        observe: () => seen[0],
      }),
    }
  }

  test("#given a stub answering not_implemented on a row counted as built #then it is named", async () => {
    const evidence = await runEffectScenarios(builtRows, [
      fakeRoot({ kind: "error", error: { code: "not_implemented" } }),
    ])
    expect(conformanceProblems(builtRows, open, evidence)).toEqual([
      "row threads.locate: scenario locate-by-id answered not_implemented; threads.locate is a stub, build it",
    ])
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
      status: "passed",
      effect: { port: "p", observed: 1 },
    }
    expect(conformanceProblems(builtRows, open, [wrong])).toEqual([
      "row threads.locate: scenario locate-by-id ran threads.list for threads.locate, not threads.locate",
    ])
  })

  test("#given the first correct closure of a gap with its run evidence #then the baseline admits it (positive control)", async () => {
    const evidence = await runEffectScenarios(builtRows, [fakeRoot({ kind: "ok", thread: "t1" })])
    expect(evidence).toEqual([
      {
        scenario: "locate-by-id",
        capability: "threads.locate",
        member: "threads.locate",
        input: { thread: "t1" },
        status: "passed",
        effect: { port: "host.listSessions", observed: { thread: "t1" } },
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
