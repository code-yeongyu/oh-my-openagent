import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { type Baseline, baselineProblems, ORIGINAL_PATH, PIN_PATH, sha256, UNRESOLVED_PATH } from "./baseline"
import { conformanceProblems } from "./conformance"
import { gateReport, goldenProblems, type GateInput, renderReport } from "./gate"
import { allRows, loadDomainFiles, REPO_ROOT } from "./registry"
import type { Scenario } from "./scenarios"
import type { Row } from "./schema"

// Negative controls of design 7.6 for the baseline, the changed-capability gate (with the two tiers of amendment 2),
// the goldens and the conformance rule: each one breaks one thing and expects a message naming what to fix.

const rows = allRows(loadDomainFiles())
const text = (path: string): string => readFileSync(join(REPO_ROOT, path), "utf8")
const original = text(ORIGINAL_PATH)
const unresolved = JSON.parse(text(UNRESOLVED_PATH)) as Baseline
const scenario: Scenario = { id: "s1", capability: "threads.send", surface: "native", argv: ["thread", "send", "x"] }

const input = (overrides: Partial<GateInput> = {}): GateInput => ({
  base: { rows, tools: [], outcomes: { s1: { exit: 2 } }, unresolved: unresolved.entries },
  head: { rows, tools: [], outcomes: { s1: { exit: 2 } }, unresolved: unresolved.entries },
  scenarios: [scenario],
  closures: new Map([["threads.send", new Set(["packages/omo-native/bin/lib/thread.js"])]]),
  changedFiles: [],
  body: "",
  ...overrides,
})

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
    const tool = (maxLength: number) => [{ name: "thread_send", parameters: { properties: { message: { type: "string", maxLength } } } }]
    const report = gateReport(input({ base: { ...input().base, tools: tool(10) }, head: { ...input().head, tools: tool(20) } }))
    expect(report.failures).toContainEqual(expect.stringContaining("threads.send: tool thread_send changed its input schema"))
  })

  test("#given a core-only change under an unresolved entry, every descriptor, schema and outcome equal #then it is reported with the body line it needs, not failed", () => {
    const report = gateReport(input({ changedFiles: ["packages/omo-native/bin/lib/thread.js"] }))
    expect(report.failures).toEqual([])
    expect(report.closureOnly).toEqual(["threads.send"])
    expect(renderReport(report)).toContain("MISSING: the body needs the line `SDK-Parity-Unchanged: yes`")
    expect(gateReport(input({ changedFiles: ["packages/omo-native/bin/lib/thread.js"], body: "SDK-Parity-Unchanged: yes\n" })).unchangedLine).toBe(true)
  })

  test("#given a security-gated entry cleared without its slice line #then it fails, naming the slice", () => {
    const head = { ...input().head, unresolved: unresolved.entries.filter((entry) => entry.id !== "engine.trust.ensure") }
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
    atBase,
  })

  test("#given an entry the original lacks #then it is refused, naming the call to build", () => {
    const added = { ...unresolved, entries: [...unresolved.entries, { id: "threads.teleport", gap: "x", slice: "T1b", issue: "new" }] }
    expect(baselineProblems(state(added))).toContainEqual(expect.stringContaining("lists threads.teleport, which script/sdk-parity/baseline.original.json lacks"))
  })

  test("#given an entry the merge base had cleared #then restoring it is refused", () => {
    const cleared = { ...unresolved, entries: unresolved.entries.filter((entry) => entry.id !== "threads.archive") }
    const restored = baselineProblems({ ...state(unresolved), atBase: { ...atBase, unresolved: cleared } })
    expect(restored).toContainEqual(expect.stringContaining("restores threads.archive, which the merge base had cleared"))
  })

  test("#given the original and its pin edited together #then the pin read from the merge base refuses both", () => {
    const edited = original.replace('"no SDK call"', '"no call"')
    const problems = baselineProblems(state(unresolved, edited, `${sha256(edited)}\n`))
    expect(problems).toContainEqual(expect.stringContaining("is written once and never changes"))
    expect(problems).toContainEqual(expect.stringContaining("does not match the pin read from the merge base"))
  })
})

describe("negative controls: goldens and conformance (7.6)", () => {
  test("#given a stored golden edited with the behaviour unchanged #then it differs from the live outcome", () => {
    expect(goldenProblems({ s1: { exit: 3 } }, { s1: { exit: 2 } })).toEqual([
      "goldens.json s1 differs from the scenario's live outcome; regenerate with bun script/sdk-parity/scenario-run.ts --out script/sdk-parity/goldens.json",
    ])
  })

  const built = (scenarios: Row["scenarios"]): Row[] =>
    rows.map((row) => (row.id === "threads.locate" ? { ...row, today: "yes", scenarios } : row))
  const open = new Set(unresolved.entries.map((entry) => entry.id).filter((id) => id !== "threads.locate"))

  test("#given a stub answering not_implemented on a row counted as built #then it is named", () => {
    const problems = conformanceProblems(built({ effect: ["locate-by-id"], refusal: [] }), open, [{ scenario: "locate-by-id", code: "not_implemented" }])
    expect(problems).toEqual(["row threads.locate: scenario locate-by-id answered not_implemented; threads.locate is a stub, build it"])
  })

  test("#given a row whose only scenario is a refusal #then it is not counted as built", () => {
    const problems = conformanceProblems(built({ effect: [], refusal: ["locate-missing"] }), open, [{ scenario: "locate-missing", code: "not_found" }])
    expect(problems).toEqual(["row threads.locate's only scenarios are refusals; add an effect scenario for each input of threads.locate"])
  })
})
