import { describe, expect, test } from "bun:test"
import { type Baseline, baselineProblems, PIN_PATH, sha256 } from "./baseline"
import type { EffectEvidence } from "./conformance"
import { candidateDigest, gateReport, renderReport } from "./gate"
import { HEAD, input, original, rows, text, unresolved } from "./gate-fixture"
import type { Row } from "./schema"
import { verifyReview } from "./verify-review"

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
    context: { effects: {} },
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
      context: { effects: {} },
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

describe("the descriptor and its contract annotation (design 7.4 amendment 5, review 6061624223 H2)", () => {
  const typed = (change: (row: Row) => Row = (row) => row) =>
    rows.map((row): Row => {
      if (row.id !== "threads.read") return row
      const properties = Object.fromEntries(
        Object.entries(row.input.properties).map(([name, schema]) => [
          name,
          { ...schema, type: name === "limit" ? "integer" : "string" },
        ]),
      )
      return change({ ...row, input: { ...row.input, properties } })
    })
  const report = (head: readonly Row[]) => gateReport(input({ head: { ...input().head, rows: head } }))

  test("#given existing fields typed and nothing else (a P1a transition) #then it is a candidate, not a failure", () => {
    const result = report(typed())
    expect(result.failures).toEqual([])
    expect(result.candidates).toEqual(["threads.read"])
  })

  test("#given the same plus one field added #then it fails", () => {
    const result = report(
      typed((row) => ({
        ...row,
        input: { ...row.input, properties: { ...row.input.properties, since: { type: "string" } } },
      })),
    )
    expect(result.failures).toEqual([
      "threads.read: its descriptor changed under an unresolved gap; add the SDK call threads.read and its scenarios in this pull request",
    ])
  })

  test("#given the same plus required flipped on a field #then it fails", () => {
    const result = report(
      typed((row) => ({ ...row, input: { ...row.input, required: [...row.input.required, "limit"] } })),
    )
    expect(result.failures).toContainEqual(
      expect.stringContaining("threads.read: its descriptor changed under an unresolved gap"),
    )
  })

  test("#given the same plus a flag target changed #then it fails", () => {
    const result = report(
      typed((row) => ({
        ...row,
        cli: row.cli.map((entry) =>
          entry.route.join(" ") === "thread read"
            ? { ...entry, flags: { ...entry.flags, "--limit": "max_bytes" } }
            : entry,
        ),
      })),
    )
    expect(result.failures).toContainEqual(
      expect.stringContaining("threads.read: its descriptor changed under an unresolved gap"),
    )
  })
})

describe("a built call's nested schema change (design 7.4 amendments 5 and 7, review 6061874518)", () => {
  // The check is two-way: a newly accepted input changes behaviour as much as a newly refused one.
  const strict = { type: "string", minLength: 1 }
  const withThread = (schema: object): Row[] =>
    rows.map((row): Row =>
      row.id === "threads.locate"
        ? { ...row, input: { ...row.input, properties: { ...row.input.properties, thread: schema } } }
        : row,
    )
  const built = unresolved.entries.filter((entry) => entry.id !== "threads.locate")
  for (const [direction, base, head] of [
    ["narrowing", withThread({}), withThread(strict)],
    ["widening", withThread(strict), withThread({})],
  ] as const)
    test(`#given a built row whose nested input shape changed by ${direction} with equal outcomes #then it is marked for the live-schema check and the verifier withholds without a review`, () => {
      const report = gateReport(
        input({
          base: { ...input().base, rows: base, unresolved: built },
          head: { ...input().head, rows: head, unresolved: built },
        }),
      )
      expect(report.failures).toEqual([])
      expect(report.liveSchema).toEqual(["threads.locate"])
      const output = renderReport(report)
      expect(output).toContain("LIVE SCHEMA CHECK: threads.locate")
      expect(output).toContain("count=1 ids=threads.locate#live-schema")
      expect(verifyReview(output, "SDK-Parity-Unchanged: yes\n", "").decision).toBe("withheld")
    })
})
