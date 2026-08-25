import { describe, expect, test } from "bun:test"

import {
  MEMORY_REFLECTING_FRAMES,
  createMemoryFooterLive,
  type MemoryFooterTimers,
} from "./status-live"
import { MEMORY_STATUS_KEY } from "./status"

interface FakeTimers extends MemoryFooterTimers {
  readonly live: () => number
  readonly advance: (ticks: number) => void
}

/** Deterministic timer double: nothing here depends on the wall clock. */
function fakeTimers(): FakeTimers {
  const handles = new Map<number, { callback: () => void; intervalMs: number }>()
  let nextHandle = 1
  return {
    set(callback, intervalMs) {
      const handle = nextHandle
      nextHandle += 1
      handles.set(handle, { callback, intervalMs })
      return handle
    },
    clear(handle) {
      handles.delete(handle as number)
    },
    live: () => handles.size,
    advance(ticks) {
      for (let tick = 0; tick < ticks; tick += 1) {
        for (const entry of [...handles.values()]) entry.callback()
      }
    },
  }
}

function recorder() {
  const calls: Array<{ key: string; text: string | undefined }> = []
  return {
    calls,
    ui: {
      setStatus(key: string, text: string | undefined): void {
        calls.push({ key, text })
      },
    },
  }
}

describe("memory footer live", () => {
  test("#given an active reflection run #when frames tick at the animation cadence #then the memory key cycles reflecting frames", () => {
    const timers = fakeTimers()
    const ui = recorder()
    const live = createMemoryFooterLive({ timers })

    live.setActive("agent-test", true, ui.ui)
    timers.advance(3)

    expect(ui.calls.map((call) => call.key)).toEqual(Array(4).fill(MEMORY_STATUS_KEY))
    // Literal glyphs, not `MEMORY_REFLECTING_FRAMES[n]`: deriving the expectation from the constant
    // the code under test indexes would keep this green even if the glyph table were corrupted.
    expect(ui.calls.map((call) => call.text)).toEqual([
      "mem:agent-test ⠋ reflecting",
      "mem:agent-test ⠙ reflecting",
      "mem:agent-test ⠹ reflecting",
      // Derived on purpose: what is under test here is modulo wrap-around, not glyph identity.
      `mem:agent-test ${MEMORY_REFLECTING_FRAMES[3 % MEMORY_REFLECTING_FRAMES.length]} reflecting`,
    ])
    live.dispose()
  })

  test("#given the animation is running #when the interval is inspected #then it uses the 320ms cadence", () => {
    const intervals: number[] = []
    const timers: MemoryFooterTimers = {
      set(_callback, intervalMs) {
        intervals.push(intervalMs)
        return 1
      },
      clear() {},
    }
    const ui = recorder()
    const live = createMemoryFooterLive({ timers })

    live.setActive("agent-test", true, ui.ui)

    expect(intervals).toEqual([320])
    live.dispose()
  })

  test("#given a run that settles #when the run is marked inactive #then the timer stops and the segment line is restored", async () => {
    const timers = fakeTimers()
    const ui = recorder()
    const live = createMemoryFooterLive({
      timers,
      refreshSegments: async (identity) => `mem:${identity} 2h ago* (+4)`,
    })

    live.setActive("agent-test", true, ui.ui)
    timers.advance(2)
    expect(timers.live()).toBe(1)

    live.setActive("agent-test", false, ui.ui)
    await live.settled()

    expect(timers.live()).toBe(0)
    expect(ui.calls.at(-1)).toEqual({
      key: MEMORY_STATUS_KEY,
      text: "mem:agent-test 2h ago* (+4)",
    })
    live.dispose()
  })

  test("#given an animating run #when dispose runs for a session shutdown #then no interval survives and no further status is published", () => {
    const timers = fakeTimers()
    const ui = recorder()
    const live = createMemoryFooterLive({ timers })

    live.setActive("agent-test", true, ui.ui)
    timers.advance(1)
    const before = ui.calls.length

    live.dispose()

    expect(timers.live()).toBe(0)
    timers.advance(5)
    expect(ui.calls).toHaveLength(before)
  })

  test("#given no bound identity #when activity is reported #then nothing animates and no timer starts", () => {
    const timers = fakeTimers()
    const ui = recorder()
    const live = createMemoryFooterLive({ timers })

    live.setActive(undefined, true, ui.ui)
    timers.advance(3)

    expect(timers.live()).toBe(0)
    expect(ui.calls).toEqual([])
    live.dispose()
  })

  test("#given repeated activation for the same run #when setActive is called twice #then a single interval is live", () => {
    const timers = fakeTimers()
    const ui = recorder()
    const live = createMemoryFooterLive({ timers })

    live.setActive("agent-test", true, ui.ui)
    live.setActive("agent-test", true, ui.ui)

    expect(timers.live()).toBe(1)
    live.dispose()
  })

  test("#given an unchanged fingerprint #when refresh is requested twice #then the second refresh does no recompute", async () => {
    const timers = fakeTimers()
    const ui = recorder()
    let computes = 0
    const live = createMemoryFooterLive({
      timers,
      fingerprint: async () => "sha-1|dirty|0|0",
      refreshSegments: async (identity) => {
        computes += 1
        return `mem:${identity} 1m ago`
      },
    })

    await live.refresh("agent-test", ui.ui)
    await live.refresh("agent-test", ui.ui)

    expect(computes).toBe(1)
    expect(ui.calls).toHaveLength(1)
    live.dispose()
  })

  test("#given HEAD moves after a cached refresh #when the fingerprint changes #then the stale footer is replaced", async () => {
    const timers = fakeTimers()
    const ui = recorder()
    let head = "sha-1"
    const live = createMemoryFooterLive({
      timers,
      fingerprint: async () => `${head}|clean|0|0`,
      refreshSegments: async (identity) => `mem:${identity} ${head}`,
    })

    await live.refresh("agent-test", ui.ui)
    head = "sha-2"
    await live.refresh("agent-test", ui.ui)

    expect(ui.calls.map((call) => call.text)).toEqual([
      "mem:agent-test sha-1",
      "mem:agent-test sha-2",
    ])
    live.dispose()
  })

  test("#given a run is active #when a segment refresh is requested #then the spinner is not overwritten", async () => {
    const timers = fakeTimers()
    const ui = recorder()
    const live = createMemoryFooterLive({
      timers,
      fingerprint: async () => "sha-1|clean|0|0",
      refreshSegments: async (identity) => `mem:${identity} 1m ago`,
    })

    live.setActive("agent-test", true, ui.ui)
    const framesOnly = ui.calls.length
    await live.refresh("agent-test", ui.ui)

    expect(ui.calls).toHaveLength(framesOnly)
    live.dispose()
  })

  test("#given a refresh source that throws #when refresh runs #then the failure is swallowed and no status is published", async () => {
    const timers = fakeTimers()
    const ui = recorder()
    const live = createMemoryFooterLive({
      timers,
      fingerprint: async () => {
        throw new Error("git exploded")
      },
      refreshSegments: async () => "unused",
    })

    await live.refresh("agent-test", ui.ui)

    expect(ui.calls).toEqual([])
    live.dispose()
  })

  test("#given an animating run #when stop runs for a footer clear #then the interval dies and no further status is published", () => {
    const timers = fakeTimers()
    const ui = recorder()
    const live = createMemoryFooterLive({ timers })

    live.setActive("agent-test", true, ui.ui)
    timers.advance(2)
    const before = ui.calls.length

    live.stop()

    expect(timers.live()).toBe(0)
    timers.advance(10)
    expect(ui.calls).toHaveLength(before)
    live.dispose()
  })

  test("#given a stopped footer #when a later session activates a run #then animation resumes", () => {
    const timers = fakeTimers()
    const ui = recorder()
    const live = createMemoryFooterLive({ timers })

    live.setActive("agent-test", true, ui.ui)
    live.stop()
    const afterStop = ui.calls.length
    live.setActive("agent-test", true, ui.ui)
    timers.advance(1)

    expect(timers.live()).toBe(1)
    expect(ui.calls.length).toBeGreaterThan(afterStop)
    live.dispose()
  })

  test("#given a disposed footer #when activity or refresh arrive afterwards #then no status is published", async () => {
    const timers = fakeTimers()
    const ui = recorder()
    const live = createMemoryFooterLive({
      timers,
      fingerprint: async () => "sha|clean|0|0",
      refreshSegments: async () => "mem:agent-test 1m ago",
    })

    live.dispose()
    live.setActive("agent-test", true, ui.ui)
    await live.refresh("agent-test", ui.ui)

    expect(timers.live()).toBe(0)
    expect(ui.calls).toEqual([])
  })
})
