import { describe, expect, test } from "bun:test"

import {
  decideTier,
  decideWatch,
  guestJobState,
  LEGS,
  ledgerRows,
  ledgerTsv,
  parseFacts,
  planLegs,
  scenarioBuilt,
  setLine,
  validateLedger,
} from "./windows-full-ledger.ts"
import { combineRuns, type Facts } from "./windows-full-verdicts.ts"

const elevated = (run: number): Facts => ({
  leg: "elevated",
  run,
  workerLabel: "S-1-16-8192",
  controlLabel: "S-1-16-12288",
  fixtureLabel: "S-1-16-12288",
  control: { postLanded: true, sendLanded: true },
  medium: { postOk: false, postError: 5, sendCount: 1, postLanded: false, sendLanded: false },
})

describe("[ADP-26] runs, ledger and validation", () => {
  test("runs that agree keep the verdict; runs that disagree read UNMEASURED", () => {
    const a = { verdict: "CONFIRMS" as const, evidence: "a" }
    const b = { verdict: "CONTRADICTS" as const, evidence: "b" }
    expect(combineRuns([a, a]).verdict).toBe("CONFIRMS")
    const mixed = combineRuns([a, b])
    expect(mixed.verdict).toBe("UNMEASURED")
    expect(mixed.evidence).toContain("runs disagree")
    expect(combineRuns([]).verdict).toBe("UNMEASURED")
  })

  test("parseFacts keeps JSON lines with a leg and reports the rest", () => {
    const { facts, rejected } = parseFacts('{"leg":"facts","run":1}\nnot json\n{"run":2}\n\n')
    expect(facts.length).toBe(1)
    expect(rejected).toBe(2)
  })

  test("the ledger has one row per question, verdict in column 3 and evidence in column 4", () => {
    const rows = ledgerRows([elevated(1), elevated(2)], { host: "hosted windows-latest", measuredAt: "2026-11-12T10:00:00Z" })
    expect(rows.map((r) => r.leg)).toEqual(LEGS.map((l) => l.leg))
    const tsv = ledgerTsv(rows)
    const lines = tsv.trimEnd().split("\n")
    expect(lines[0]).toBe("question\tleg\tverdict\tevidence\trerun\thost\tmeasured_at")
    const q1 = lines[1]?.split("\t") ?? []
    expect(q1[2]).toBe("CONFIRMS")
    expect(q1[3]).toContain("2/2 runs")
    const q2 = lines.find((l) => l.split("\t")[1] === "lock")?.split("\t") ?? []
    expect(q2[2]).toBe("UNMEASURED")
    expect(q2[3]).toContain("no facts")
    expect(validateLedger(tsv)).toEqual([])
  })

  test("validation names an empty evidence cell, a bad verdict and a missing leg", () => {
    const tsv = "question\tleg\tverdict\tevidence\trerun\thost\tmeasured_at\nq1\televated\tYES\t\tr\th\tt\n"
    const errors = validateLedger(tsv)
    expect(errors.some((e) => e.includes("verdict YES"))).toBe(true)
    expect(errors.some((e) => e.includes("empty evidence"))).toBe(true)
    expect(errors.some((e) => e.includes("missing leg lock"))).toBe(true)
  })
})

describe("[ADP-26] tier plan, runs and the guest watchdog", () => {
  const verdicts = { elevated: "CONFIRMS", lock: "UNMEASURED", disconnect: "CONTRADICTS", "mixed-dpi": "CONFIRMS", "secure-desktop": "CONTRADICTS" } as const

  test("CONFIRMS runs hosted; the rest go to the guest when it is on, else blocked with no_windows_host", () => {
    const off = planLegs(verdicts, false)
    expect(off.find((p) => p.leg === "elevated")?.tier).toBe("hosted")
    expect(off.find((p) => p.leg === "lock")).toEqual({ leg: "lock", tier: "blocked", reason: "no_windows_host" })
    expect(planLegs(verdicts, true).find((p) => p.leg === "lock")?.tier).toBe("guest")
  })

  test("the tier decision is hosted, guest or partial", () => {
    expect(decideTier(planLegs(verdicts, false))).toBe("partial")
    expect(decideTier(planLegs(verdicts, true))).toBe("guest")
    const all = { elevated: "CONFIRMS", lock: "CONFIRMS", disconnect: "CONFIRMS", "mixed-dpi": "CONFIRMS", "secure-desktop": "CONFIRMS" } as const
    expect(decideTier(planLegs(all, false))).toBe("hosted")
  })

  test("a scenario is built only when the driver quotes its name", () => {
    expect(scenarioBuilt(null, "screen-locked-last")).toBe(false)
    expect(scenarioBuilt('const S = ["screen-locked-last-x"]', "screen-locked-last")).toBe(false)
    expect(scenarioBuilt('const S = ["screen-locked-last"]', "screen-locked-last")).toBe(true)
  })

  test("the set line names backend_not_built only when it is the reason", () => {
    expect(setLine("hosted", { pass: 0, fail: 0, blocked: 2, notBuilt: 2 })).toBe(
      "SET windows-full tier=hosted pass=0 fail=0 blocked=2 reason=backend_not_built",
    )
    expect(setLine("guest", { pass: 1, fail: 0, blocked: 0, notBuilt: 0 })).toBe("SET windows-full tier=guest pass=1 fail=0 blocked=0")
  })

  test("the watchdog fails with runner_unavailable when the guest job has not started by the deadline", () => {
    const jobs = [
      { name: "computer live windows-full (guest)", status: "queued" },
      { name: "computer live windows-full (host)", status: "completed" },
    ]
    expect(guestJobState(jobs, "computer live windows-full (guest)")).toBe("queued")
    expect(guestJobState([], "computer live windows-full (guest)")).toBe("absent")
    expect(guestJobState([{ name: "computer live windows-full (guest)", status: "in_progress" }], "computer live windows-full (guest)")).toBe("started")
    expect(decideWatch("queued", 100, 900)).toBe("wait")
    expect(decideWatch("queued", 900, 900)).toBe("runner_unavailable")
    expect(decideWatch("absent", 900, 900)).toBe("runner_unavailable")
    expect(decideWatch("started", 10, 900)).toBe("ok")
  })
})
