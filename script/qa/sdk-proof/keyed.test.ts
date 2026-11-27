import { describe, expect, test } from "bun:test"

import type { Driver } from "./drivers/driver.ts"
import { openKeyedThread, runKeyedPairs } from "./keyed.ts"
import type { Surface } from "./evidence.ts"
import { OPS } from "./scenario.ts"

// The keyed pairs keep the scenario's bounded-call contract: a send that never answers is aborted at the deadline,
// its pair fails as the harness's, the later pairs are not reached, and nothing is observed after the stall.

const stalling = (signals: AbortSignal[]): Driver => ({
  mapping: Object.fromEntries(OPS.map((op) => [op, { kind: "call", how: op }])) as Driver["mapping"],
  run: (_call, signal) => {
    if (signal !== undefined) signals.push(signal)
    return new Promise(() => {})
  },
  close: async () => {},
})

describe("the keyed pairs on a stalled surface", () => {
  test("#given a driver that never answers #when the pairs run #then the stall is aborted and the rest not reached", async () => {
    // given
    const signals: AbortSignal[] = []
    const judged: string[] = []
    const drivers = { sdk: stalling(signals), tools: stalling(signals), cli: stalling(signals) } satisfies Record<
      Surface,
      Driver
    >
    const observer = {
      judge: async () => {
        judged.push("judged")
        return { ok: true, why: "", state: { listed: true, streaming: false, messages: [], held: [] } }
      },
    }

    // when
    const records = await runKeyedPairs(drivers, "dev-b/t-1", "key", observer, 20)

    // then
    expect(records[0]).toMatchObject({ cell: "fail" })
    expect(records[0]?.why).toContain("the harness")
    expect(records.slice(1).every((record) => record.cell === "not reached")).toBe(true)
    expect(signals.map((signal) => signal.aborted)).toEqual([true])
    expect(judged).toEqual([])
  })
})

describe("opening the keyed pairs' thread", () => {
  test("#given a CLI open that never answers #when the thread is opened #then the call is aborted and no thread is taken", async () => {
    // given
    const signals: AbortSignal[] = []
    const observer = { keys: async () => new Set<string>(), adopt: async () => "adopted" }

    // when
    const opened = await openKeyedThread(stalling(signals), "dev-b", observer, 20)

    // then
    expect(opened).toEqual({ thread: undefined, key: undefined, stalled: true })
    expect(signals.map((signal) => signal.aborted)).toEqual([true])
  })
})

describe("the keyed pairs with no thread", () => {
  test("#given the thread's open stalled #when the pairs run #then each pair names that reason", async () => {
    const signals: AbortSignal[] = []
    const drivers = { sdk: stalling(signals), tools: stalling(signals), cli: stalling(signals) } satisfies Record<
      Surface,
      Driver
    >
    const observer = {
      judge: async () => ({ ok: true, why: "", state: { listed: true, streaming: false, messages: [], held: [] } }),
    }
    const records = await runKeyedPairs(drivers, undefined, undefined, observer, 20, "the open stalled")
    expect(records.map((record) => [record.cell, record.why])).toEqual(
      records.map(() => ["not reached", "the open stalled"]),
    )
    expect(signals).toEqual([])
  })
})
