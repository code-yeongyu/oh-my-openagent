// The `--all` set contract (R55/R55a): one `SET linux/<session> pass=<n> fail=<n> blocked=<n>`
// line, a failing scenario counts fail and makes the exit non-zero, and a scenario the host
// cannot admit counts blocked with its reason, never pass.
import { expect, test } from "bun:test"

import { verdict, type Scenario } from "./scenario.ts"
import { ALL_BLOCKED_EXIT, admission, type Outcome, setExitCode, setLine } from "./set.ts"

function scenario(name: string, sessions: Scenario["sessions"], requires: readonly string[] = []): Scenario {
  return {
    name,
    admit: "os",
    sessions,
    requires,
    run: () => Promise.resolve({ checks: {}, facts: {}, observer: { before: {}, after: {} } }),
  }
}

function ran(name: string, ok: boolean): Outcome {
  return {
    kind: "ran",
    result: verdict(name, "xvfb", { checks: { holds: ok }, facts: {}, observer: { before: {}, after: {} } }),
  }
}

test("a failing scenario counts fail=1 and makes the set exit non-zero", () => {
  const outcomes = [ran("a", true), ran("b", false)]
  expect(setLine("xvfb", outcomes)).toBe("SET linux/xvfb pass=1 fail=1 blocked=0")
  expect(setExitCode(outcomes)).not.toBe(0)
})

test("a scenario the session cannot admit counts blocked with its reason, never pass", () => {
  const reason = admission(scenario("no-display", ["none"]), "xvfb", undefined)
  expect(reason).toBeDefined()
  const outcomes: Outcome[] = [ran("a", true), { kind: "blocked", scenario: "no-display", reason: reason ?? "" }]
  expect(setLine("xvfb", outcomes)).toBe("SET linux/xvfb pass=1 fail=0 blocked=1")
  expect(setExitCode(outcomes)).toBe(0)
})

test("a session that did not start blocks every scenario under it", () => {
  const reason = admission(scenario("xft-dpi-scale", ["xorg"]), "xorg", "runs directly on the host")
  expect(reason).toContain("runs directly on the host")
  expect(admission(scenario("xft-dpi-scale", ["xvfb"]), "xvfb", undefined)).toBeUndefined()
})

test("a scenario whose host tool is missing counts blocked naming the tool, never fail", () => {
  const needs = scenario("occluder-oracle", ["xvfb"], ["xdotool", "xwd"])
  const reason = admission(needs, "xvfb", undefined, (tool) => tool === "xwd")
  expect(reason).toContain("xdotool")
  expect(reason).not.toContain("xwd")
  expect(admission(needs, "xvfb", undefined, () => true)).toBeUndefined()
})

test("a set in which nothing passed and nothing failed exits non-zero with its own code, so it never reads as green", () => {
  const blocked: Outcome[] = [
    { kind: "blocked", scenario: "a", reason: "this host lacks xfwm4" },
    { kind: "blocked", scenario: "b", reason: "this host lacks xfwm4" },
  ]
  expect(setLine("xvfb", blocked)).toBe("SET linux/xvfb pass=0 fail=0 blocked=2")
  expect(setExitCode(blocked)).toBe(ALL_BLOCKED_EXIT)
  expect(setExitCode([ran("a", false), ...blocked])).toBe(1)
  expect(setExitCode([])).toBe(ALL_BLOCKED_EXIT)
})
