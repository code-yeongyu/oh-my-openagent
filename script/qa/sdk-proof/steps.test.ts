import { describe, expect, test } from "bun:test"

import type { Driver } from "./drivers/driver.ts"
import { OPS } from "./scenario.ts"
import { prepared, runSteps, type StepWorld, unprepared } from "./steps.ts"
import type { Observer } from "./world/observe.ts"

// The runner's own contract on a stall, with a stand-in world: the stalled call is aborted, its cell fails on the
// deadline, nothing is observed after it, and every later cell of the surface reads not reached.

const idleState = { listed: false, streaming: false, messages: [], held: [] }

const standInWorld = (judged: string[]): StepWorld => {
  const observer: Observer = {
    adopt: async () => undefined,
    keys: async () => new Set(),
    read: async () => idleState,
    judge: async (_key, expectation) => {
      judged.push(expectation.kind)
      return { ok: true, why: "B shows the expected state", state: idleState }
    },
    fill: async () => ({ failed: "no fill in the stand-in world" }),
    close: () => {},
  }
  return { account: true, observer, release: () => {} }
}

const stalling = (signals: AbortSignal[]): Driver => ({
  mapping: Object.fromEntries(OPS.map((op) => [op, { kind: "call", how: op }])) as Driver["mapping"],
  run: (_call, signal) => {
    if (signal !== undefined) signals.push(signal)
    return new Promise(() => {})
  },
  close: async () => {},
})

describe("the runner on a stalled surface", () => {
  test("#given a driver that never answers #when the scenario runs #then the call is aborted and the rest is not reached", async () => {
    // given
    const signals: AbortSignal[] = []
    const judged: string[] = []

    // when
    const records = await runSteps("sdk", standInWorld(judged), stalling(signals), 20)

    // then
    expect(records[0]).toMatchObject({ step: "open", cell: "fail", observed: null })
    expect(records.slice(1).every((record) => record.cell === "not reached")).toBe(true)
    expect(records.slice(1).every((record) => record.why.includes("did not answer within the step deadline"))).toBe(
      true,
    )
    expect(signals.map((signal) => signal.aborted)).toEqual([true])
    expect(judged).toEqual([])
  })
})

describe("a surface's preparation", () => {
  test("#given a preparation that never finishes #when bounded #then it is not used and every cell is not reached", async () => {
    // given
    let release: (driver: string) => void = () => {}
    const late: string[] = []
    const preparation = new Promise<string>((resolve) => {
      release = resolve
    })

    // when
    const ready = await prepared(preparation, 20, (value) => late.push(value))
    release("a driver that came too late")
    await preparation

    // then
    expect(ready).toBeUndefined()
    expect(late).toEqual(["a driver that came too late"])
    const cells = unprepared("tools", "the tools surface's preparation")
    expect(cells.every((cell) => cell.cell === "not reached" && cell.slice.startsWith("the harness"))).toBe(true)
  })

  test("#given a preparation that finishes in time #when bounded #then it is used and nothing is handed back", async () => {
    const late: string[] = []
    expect(await prepared(Promise.resolve("driver"), 1_000, (value) => late.push(value))).toBe("driver")
    expect(late).toEqual([])
  })
})
