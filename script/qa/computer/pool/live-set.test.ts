import { describe, expect, test } from "bun:test"
import { blockedSet, MACOS_SCENARIOS, receiptLine, type ScenarioReceipt, summarizeSet } from "./live-set.ts"

const cores = 10

const pass: ScenarioReceipt = {
  scenario: "frame-verbs",
  route: "synthetic-user",
  durationMs: 2_500,
  hostLoad: 1.25,
  outcome: { kind: "pass", oracle: "fixture report\nmoved 40 px", refusalLeg: "minimized window refused" },
}

const loadedPass: ScenarioReceipt = { ...pass, scenario: "key-hold", hostLoad: 14.7 }

const fail: ScenarioReceipt = {
  scenario: "key-hold",
  route: "none",
  durationMs: 900,
  hostLoad: 1.25,
  outcome: { kind: "fail", detail: "held key" },
}

describe("live macOS set summary", () => {
  test("a set where nothing ran never exits 0, so a job cannot show green while every scenario is blocked", () => {
    const summary = summarizeSet("macos", blockedSet("backend_not_built", "none", 1.25), cores)
    expect(summary.line).toBe(
      `SET macos pass=0 fail=0 blocked=${MACOS_SCENARIOS.length} degraded=0 reason=backend_not_built hostLoad=1.25 cores=10 p99Ms=0`,
    )
    expect(summary.exitCode).toBe(3)
  })

  test("one failing scenario makes the set exit 1", () => {
    expect(summarizeSet("macos", [pass, fail], cores)).toEqual({
      line: "SET macos pass=1 fail=1 blocked=0 degraded=0 hostLoad=1.25 cores=10 p99Ms=2500",
      exitCode: 1,
    })
  })

  test("an empty set is a failure, never a green run", () => {
    expect(summarizeSet("macos", [], cores).exitCode).toBe(1)
  })

  test("a pass under a host load above the core count counts as degraded, never as pass (R-S4-1)", () => {
    const summary = summarizeSet("macos", [loadedPass], cores)
    expect(summary.line).toBe("SET macos pass=0 fail=0 blocked=0 degraded=1 hostLoad=14.7 cores=10 p99Ms=2500")
    expect(summary.exitCode).toBe(3)
  })

  test("load is judged per leg: only the leg that ran over load is degraded, and hostLoad is the highest leg load", () => {
    expect(summarizeSet("macos", [pass, loadedPass], cores)).toEqual({
      line: "SET macos pass=1 fail=0 blocked=0 degraded=1 hostLoad=14.7 cores=10 p99Ms=2500",
      exitCode: 0,
    })
  })

  test("a load equal to the core count is still a pass", () => {
    expect(summarizeSet("macos", [{ ...pass, hostLoad: 10 }], cores).line).toBe(
      "SET macos pass=1 fail=0 blocked=0 degraded=0 hostLoad=10 cores=10 p99Ms=2500",
    )
  })

  test("p99Ms is the nearest-rank p99 of the scenarios' recorded durations, not the maximum", () => {
    const many = Array.from({ length: 101 }, (_, i): ScenarioReceipt => ({ ...pass, durationMs: (i + 1) * 10 }))
    expect(summarizeSet("macos", many, cores).line).toBe(
      "SET macos pass=101 fail=0 blocked=0 degraded=0 hostLoad=1.25 cores=10 p99Ms=1000",
    )
  })

  test("p99Ms leaves blocked legs out, so legs that never ran cannot pull it down", () => {
    const blocked: ScenarioReceipt = {
      ...pass,
      durationMs: 0,
      outcome: { kind: "blocked", reason: "backend_not_built" },
    }
    const receipts = [...Array.from({ length: 100 }, () => blocked), pass]
    expect(summarizeSet("macos", receipts, cores).line).toEndWith(" p99Ms=2500")
  })
})

describe("receipt lines", () => {
  test("a pass names its oracle and refusal leg on one line with the stop route and its measured duration", () => {
    expect(receiptLine(pass, cores)).toBe(
      "SCENARIO frame-verbs route=synthetic-user PASS oracle=fixture report moved 40 px refusal=minimized window refused durationMs=2500",
    )
  })

  test("a pass under a host load above the core count reads DEGRADED, never PASS (R-S4-1)", () => {
    expect(receiptLine(loadedPass, cores)).toStartWith("SCENARIO key-hold route=synthetic-user DEGRADED ")
  })

  test("a pass at a load equal to the core count reads PASS", () => {
    expect(receiptLine({ ...pass, hostLoad: 10 }, cores)).toStartWith("SCENARIO frame-verbs route=synthetic-user PASS ")
  })

  test("a pass whose load could not be read reads DEGRADED, never PASS", () => {
    expect(receiptLine({ ...pass, hostLoad: Number.NaN }, cores)).toStartWith(
      "SCENARIO frame-verbs route=synthetic-user DEGRADED ",
    )
  })

  test("an unreadable leg load is degraded but does not hide the highest load that was read", () => {
    expect(
      summarizeSet(
        "macos",
        [
          { ...pass, hostLoad: Number.NaN },
          { ...pass, hostLoad: 3.5 },
        ],
        cores,
      ).line,
    ).toBe("SET macos pass=1 fail=0 blocked=0 degraded=1 hostLoad=3.5 cores=10 p99Ms=2500")
  })

  test("a fail and a blocked scenario carry their measured duration on their lines too", () => {
    const blocked: ScenarioReceipt = {
      scenario: "off-space-capture",
      route: "none",
      durationMs: 0,
      hostLoad: 1.25,
      outcome: { kind: "blocked", reason: "backend_not_built" },
    }
    expect(receiptLine(fail, cores)).toBe("SCENARIO key-hold route=none FAIL held key durationMs=900")
    expect(receiptLine(blocked, cores)).toBe(
      "SCENARIO off-space-capture route=none BLOCKED reason=backend_not_built durationMs=0",
    )
  })
})
