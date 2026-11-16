// R55: `windows.ts --all` runs every registered scenario and prints exactly one
// 'SET windows pass=<n> fail=<n> blocked=<n>' line. A scenario whose precondition refuses on this
// host is BLOCKED with its reason, never a pass; pass counts only scenarios that ran their oracle.
import { describe, expect, test } from "bun:test"

import { runAll, setLine } from "./set.ts"

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
