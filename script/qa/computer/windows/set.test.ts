// R55: `windows.ts --all` runs every registered scenario and prints exactly one
// 'SET windows pass=<n> fail=<n> blocked=<n>' line. A scenario whose precondition refuses on this
// host is BLOCKED with its reason, never a pass; pass counts only scenarios that ran their oracle.
import { describe, expect, test } from "bun:test"

import { gateSet, runAll, setLine } from "./set.ts"

type Fake = { readonly name: string; readonly blocked?: string; readonly result?: boolean | Error }

async function run(fakes: readonly Fake[]) {
  const lines: string[] = []
  const ran: string[] = []
  const summary = await runAll(
    fakes.map((fake) => ({ name: fake.name, precondition: async () => fake.blocked })),
    async (name) => {
      ran.push(name)
      const result = fakes.find((fake) => fake.name === name)?.result
      if (result instanceof Error) throw result
      return result === true
    },
    (line) => lines.push(line),
  )
  return { summary, lines, ran }
}

describe("windows --all", () => {
  test("a failing scenario gives fail=1 and a non-zero exit", async () => {
    const { summary, lines } = await run([
      { name: "a", result: true },
      { name: "b", result: false },
    ])
    expect(summary).toEqual({ pass: 1, fail: 1, blocked: 0, exitCode: 1 })
    expect(lines.at(-1)).toBe("SET windows pass=1 fail=1 blocked=0")
  })

  test("an unadmitted scenario counts as blocked with its reason, never as pass, and does not run", async () => {
    const { summary, lines, ran } = await run([
      { name: "capture-session0-refused", blocked: "session 1 is not session 0" },
      { name: "capture-marker-pixels", result: true },
    ])
    expect(summary).toEqual({ pass: 1, fail: 0, blocked: 1, exitCode: 0 })
    expect(ran).toEqual(["capture-marker-pixels"])
    expect(lines).toContain("BLOCKED capture-session0-refused session 1 is not session 0")
    expect(lines.indexOf("BLOCKED capture-session0-refused session 1 is not session 0")).toBeLessThan(lines.length - 1)
    expect(lines.at(-1)).toBe("SET windows pass=1 fail=0 blocked=1")
  })

  test("a scenario that throws is a fail, not a pass and not blocked", async () => {
    const { summary } = await run([{ name: "x", result: new Error("engine died") }])
    expect(summary).toEqual({ pass: 0, fail: 1, blocked: 0, exitCode: 1 })
  })

  test("exactly one SET line, last, in the gate's exact form", async () => {
    const { lines } = await run([{ name: "a", result: true }])
    expect(lines.filter((line) => line.startsWith("SET "))).toEqual(["SET windows pass=1 fail=0 blocked=0"])
    expect(setLine({ pass: 3, fail: 0, blocked: 2 })).toBe("SET windows pass=3 fail=0 blocked=2")
  })
})

// R70br(3): the Windows QA job is green only when the one SET line reads pass >= 1 and fail=0, and
// every block is a named precondition (the scenario's own admission rule) counted in that line.
describe("windows --all gate", () => {
  const blocked = "BLOCKED capture-session0-refused session 2 is not session 0"

  test("one pass, no fail, and a named block pass the gate", () => {
    expect(gateSet(["{...}", blocked, "SET windows pass=1 fail=0 blocked=1"])).toEqual([])
  })

  test("no scenario that ran and passed fails the gate", () => {
    expect(gateSet([blocked, "SET windows pass=0 fail=0 blocked=1"])).toEqual(["pass=0: no scenario ran and passed"])
  })

  test("a failure fails the gate", () => {
    expect(gateSet(["SET windows pass=1 fail=1 blocked=0"])).toEqual(["fail=1"])
  })

  test("a missing or repeated SET line fails the gate", () => {
    expect(gateSet(["PASS x"])).toEqual(["expected one SET windows line, found 0"])
    expect(gateSet(["SET windows pass=1 fail=0 blocked=0", "SET windows pass=1 fail=0 blocked=0"])).toEqual([
      "expected one SET windows line, found 2",
    ])
  })

  test("a block without a reason, or a count that does not match the BLOCKED lines, fails the gate", () => {
    expect(gateSet(["BLOCKED capture-session0-refused", "SET windows pass=1 fail=0 blocked=1"])).toEqual([
      "BLOCKED capture-session0-refused names no reason",
    ])
    expect(gateSet(["SET windows pass=1 fail=0 blocked=1"])).toEqual(["blocked=1 but 0 BLOCKED lines"])
  })
})
