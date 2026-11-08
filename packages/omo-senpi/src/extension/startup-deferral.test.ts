/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import {
  createFirstPaintScheduler,
  createLazyValue,
  createStartupDeferral,
  deferUntilAfterFirstPaint,
} from "./startup-deferral"

type Scheduled = { readonly run: () => void; cancelled: boolean }

function recordingScheduler(scheduled: Scheduled[]): (run: () => void) => () => void {
  return (run) => {
    const entry: Scheduled = { run, cancelled: false }
    scheduled.push(entry)
    return () => {
      entry.cancelled = true
    }
  }
}

describe("createLazyValue", () => {
  it("#given a lazy value #when it is never read #then the factory never runs", () => {
    // given
    let constructions = 0
    const lazy = createLazyValue(() => {
      constructions += 1
      return { id: constructions }
    })

    // then
    expect(lazy.constructed).toBe(false)
    expect(constructions).toBe(0)
  })

  it("#given a lazy value #when it is read twice #then the factory runs once and the same value comes back", () => {
    // given
    let constructions = 0
    const lazy = createLazyValue(() => {
      constructions += 1
      return { id: constructions }
    })

    // when
    const first = lazy.get()
    const second = lazy.get()

    // then
    expect(constructions).toBe(1)
    expect(lazy.constructed).toBe(true)
    expect(second).toBe(first)
  })

  it("#given a factory returning undefined #when the value is read twice #then it is still constructed once", () => {
    // given
    let constructions = 0
    const lazy = createLazyValue<undefined>(() => {
      constructions += 1
      return undefined
    })

    // when
    lazy.get()
    lazy.get()

    // then
    expect(constructions).toBe(1)
  })
})

describe("createStartupDeferral", () => {
  it("#given deferred work #when it is deferred #then nothing runs until the scheduled tick", () => {
    // given
    const scheduled: Scheduled[] = []
    const deferral = createStartupDeferral({ schedule: recordingScheduler(scheduled) })
    let ran = 0

    // when
    deferral.defer("probe", () => {
      ran += 1
    })

    // then
    expect(ran).toBe(0)
    expect(scheduled).toHaveLength(1)

    // when
    scheduled[0]?.run()

    // then
    expect(ran).toBe(1)
  })

  it("#given pending work #when the deferral retires #then the scheduled tick is cancelled and later work is refused", () => {
    // given
    const scheduled: Scheduled[] = []
    const deferral = createStartupDeferral({ schedule: recordingScheduler(scheduled) })
    let ran = 0
    deferral.defer("pending", () => {
      ran += 1
    })

    // when
    deferral.retire()
    scheduled[0]?.run()
    deferral.defer("late", () => {
      ran += 1
    })

    // then
    expect(scheduled[0]?.cancelled).toBe(true)
    expect(scheduled).toHaveLength(1)
    expect(ran).toBe(0)
  })

  it("#given work that throws #when its tick runs #then the failure is reported and never escapes the scheduler", () => {
    // given
    const scheduled: Scheduled[] = []
    const failures: Array<{ label: string; error: unknown }> = []
    const deferral = createStartupDeferral({
      schedule: recordingScheduler(scheduled),
      onError: (label, error) => failures.push({ label, error }),
    })
    deferral.defer("boom", () => {
      throw new Error("deferred boom")
    })

    // when
    scheduled[0]?.run()

    // then
    expect(failures).toHaveLength(1)
    expect(failures[0]?.label).toBe("boom")
  })

  it("#given asynchronous work that rejects #when its tick runs #then the rejection is reported", async () => {
    // given
    const scheduled: Scheduled[] = []
    const failures: Array<{ label: string; error: unknown }> = []
    const deferral = createStartupDeferral({
      schedule: recordingScheduler(scheduled),
      onError: (label, error) => failures.push({ label, error }),
    })
    deferral.defer("async-boom", async () => {
      throw new Error("deferred async boom")
    })

    // when
    scheduled[0]?.run()
    await Promise.resolve()

    // then
    expect(failures).toHaveLength(1)
    expect(failures[0]?.label).toBe("async-boom")
  })
})

describe("createFirstPaintScheduler", () => {
  function gate(): { schedule: ReturnType<typeof createFirstPaintScheduler>; fire: (event: string) => void } {
    const handlers = new Map<string, Array<() => void>>()
    const schedule = createFirstPaintScheduler({
      on: (event, handler) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
      backstopMs: 60_000,
    })
    return { schedule, fire: (event) => { for (const handler of handlers.get(event) ?? []) handler() } }
  }

  it("#given queued work #when no post-paint edge has fired #then nothing runs before the gate opens", () => {
    // given
    const { schedule, fire } = gate()
    let ran = 0

    // when
    schedule(() => { ran += 1 })

    // then
    expect(ran).toBe(0)

    // when
    fire("before_agent_start")

    // then
    expect(ran).toBe(1)
  })

  it("#given an opened gate #when more work arrives #then it is scheduled on the next tick", async () => {
    // given
    const { schedule, fire } = gate()
    fire("input")
    let ran = 0

    // when
    schedule(() => { ran += 1 })

    // then
    expect(ran).toBe(0)

    // when
    await new Promise((resolve) => setTimeout(resolve, 1))

    // then
    expect(ran).toBe(1)
  })

  it("#given queued work #when it is cancelled before the gate opens #then opening the gate runs nothing", () => {
    // given
    const { schedule, fire } = gate()
    let ran = 0
    const cancel = schedule(() => { ran += 1 })

    // when
    cancel()
    fire("input")

    // then
    expect(ran).toBe(0)
  })

  it("#given a session that never paints an edge #when the backstop elapses #then the work still runs once", async () => {
    // given
    const schedule = createFirstPaintScheduler({ on: () => undefined, backstopMs: 1 })
    let ran = 0

    // when
    schedule(() => { ran += 1 })
    await new Promise((resolve) => setTimeout(resolve, 20))

    // then
    expect(ran).toBe(1)
  })
})

describe("deferUntilAfterFirstPaint", () => {
  it("#given a context without the seam #when work is deferred #then it runs inline so isolated hosts keep today's behaviour", () => {
    // given
    let ran = 0

    // when
    deferUntilAfterFirstPaint({}, "inline", () => {
      ran += 1
    })

    // then
    expect(ran).toBe(1)
  })

  it("#given a context carrying the seam #when work is deferred #then the seam owns it", () => {
    // given
    const deferred: string[] = []

    // when
    deferUntilAfterFirstPaint({ deferStartupWork: (label) => deferred.push(label) }, "seam", () => undefined)

    // then
    expect(deferred).toEqual(["seam"])
  })
})
