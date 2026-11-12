import { describe, expect, test } from "bun:test"
import {
  blockedSet,
  MACOS_SCENARIOS,
  receiptLine,
  type ScenarioReceipt,
  summarizeSet,
  teardownLines,
} from "./live-set.ts"

const pass: ScenarioReceipt = {
  scenario: "frame-verbs",
  route: "synthetic-user",
  outcome: { kind: "pass", oracle: "fixture report\nmoved 40 px", refusalLeg: "minimized window refused" },
}

describe("live macOS set summary", () => {
  test("a set where nothing ran never exits 0, so a job cannot show green while every scenario is blocked", () => {
    const summary = summarizeSet("macos", blockedSet("backend_not_built", "none"))
    expect(summary.line).toBe(`SET macos pass=0 fail=0 blocked=${MACOS_SCENARIOS.length} reason=backend_not_built`)
    expect(summary.exitCode).toBe(3)
  })

  test("one failing scenario makes the set exit 1", () => {
    const fail: ScenarioReceipt = { scenario: "key-hold", route: "none", outcome: { kind: "fail", detail: "held key" } }
    expect(summarizeSet("macos", [pass, fail])).toEqual({ line: "SET macos pass=1 fail=1 blocked=0", exitCode: 1 })
  })

  test("an empty set is a failure, never a green run", () => {
    expect(summarizeSet("macos", []).exitCode).toBe(1)
  })
})

describe("receipt lines", () => {
  test("a pass names its oracle and refusal leg on one line with the stop route", () => {
    expect(receiptLine(pass)).toBe(
      "SCENARIO frame-verbs route=synthetic-user PASS oracle=fixture report moved 40 px refusal=minimized window refused",
    )
  })

  test("teardown prints the process count and the removed directory before any extra receipt", () => {
    expect(teardownLines({ procs: 0, removedDir: "/tmp/x", extra: ["guest DELETED g1"] })).toEqual([
      "procs 0",
      "dir REMOVED /tmp/x",
      "guest DELETED g1",
    ])
  })
})
