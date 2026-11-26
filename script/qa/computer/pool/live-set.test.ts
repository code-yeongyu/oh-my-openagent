import { describe, expect, test } from "bun:test"
import {
  blockedSet,
  type HostReadings,
  MACOS_SCENARIOS,
  receiptLine,
  type ScenarioReceipt,
  summarizeSet,
} from "./live-set.ts"

const idle: HostReadings = { load: 1.25, cores: 10 }
const loaded: HostReadings = { load: 14.7, cores: 10 }

const pass: ScenarioReceipt = {
  scenario: "frame-verbs",
  route: "synthetic-user",
  durationMs: 2_500,
  outcome: { kind: "pass", oracle: "fixture report\nmoved 40 px", refusalLeg: "minimized window refused" },
}

const fail: ScenarioReceipt = {
  scenario: "key-hold",
  route: "none",
  durationMs: 900,
  outcome: { kind: "fail", detail: "held key" },
}

describe("live macOS set summary", () => {
  test("a set where nothing ran never exits 0, so a job cannot show green while every scenario is blocked", () => {
    const summary = summarizeSet("macos", blockedSet("backend_not_built", "none"), idle)
    expect(summary.line).toBe(
      `SET macos pass=0 fail=0 blocked=${MACOS_SCENARIOS.length} degraded=0 reason=backend_not_built hostLoad=1.25 cores=10 p99Ms=0`,
    )
    expect(summary.exitCode).toBe(3)
  })

  test("one failing scenario makes the set exit 1", () => {
    expect(summarizeSet("macos", [pass, fail], idle)).toEqual({
      line: "SET macos pass=1 fail=1 blocked=0 degraded=0 hostLoad=1.25 cores=10 p99Ms=2500",
      exitCode: 1,
    })
  })

  test("an empty set is a failure, never a green run", () => {
    expect(summarizeSet("macos", [], idle).exitCode).toBe(1)
  })

  test("a pass under a host load above the core count counts as degraded, never as pass (R-S4-1)", () => {
    const summary = summarizeSet("macos", [pass], loaded)
    expect(summary.line).toBe("SET macos pass=0 fail=0 blocked=0 degraded=1 hostLoad=14.7 cores=10 p99Ms=2500")
    expect(summary.exitCode).toBe(3)
  })

  test("p99Ms is the nearest-rank p99 of the scenarios' recorded durations, not the maximum", () => {
    const many = Array.from({ length: 101 }, (_, i): ScenarioReceipt => {
      return {
        scenario: `synthetic-${i + 1}`,
        route: "none",
        durationMs: (i + 1) * 10,
        outcome: { kind: "pass", oracle: "fixture report", refusalLeg: "minimized window refused" },
      }
    })
    expect(summarizeSet("macos", many, idle).line).toBe(
      "SET macos pass=101 fail=0 blocked=0 degraded=0 hostLoad=1.25 cores=10 p99Ms=1000",
    )
  })
})

describe("receipt lines", () => {
  test("a pass names its oracle and refusal leg on one line with the stop route and its measured duration", () => {
    expect(receiptLine(pass, idle)).toBe(
      "SCENARIO frame-verbs route=synthetic-user PASS oracle=fixture report moved 40 px refusal=minimized window refused durationMs=2500",
    )
  })

  test("a pass under a host load above the core count reads DEGRADED, never PASS (R-S4-1)", () => {
    expect(receiptLine(pass, loaded)).toBe(
      "SCENARIO frame-verbs route=synthetic-user DEGRADED oracle=fixture report moved 40 px refusal=minimized window refused durationMs=2500",
    )
  })

  test("a fail and a blocked scenario carry their measured duration on their lines too", () => {
    const blocked: ScenarioReceipt = {
      scenario: "off-space-capture",
      route: "none",
      durationMs: 0,
      outcome: { kind: "blocked", reason: "backend_not_built" },
    }
    expect(receiptLine(fail, idle)).toBe("SCENARIO key-hold route=none FAIL held key durationMs=900")
    expect(receiptLine(blocked, idle)).toBe(
      "SCENARIO off-space-capture route=none BLOCKED reason=backend_not_built durationMs=0",
    )
  })
})
