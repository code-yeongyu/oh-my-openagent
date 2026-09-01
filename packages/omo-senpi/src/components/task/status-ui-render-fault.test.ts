import { describe, expect, it } from "bun:test"

import type { CapturedUi } from "./runtime-context"
import {
  createTaskStatusUi,
  type StatusUiLogger,
  type StatusUiRuntime,
  type StatusUiTimers,
} from "./status-ui"

// The render path runs from bare timer callbacks, so faults must be contained here rather than
// escaping as uncaught exceptions (the beta.20 pi-tui incident killed the host process).
const BARREL_FAULT = "The @earendil-works/pi-tui barrel was accessed before it was loaded."

function throwingUi(): CapturedUi {
  return {
    notify: () => undefined,
    setStatus: () => undefined,
    setWidget: () => {
      throw new Error(BARREL_FAULT)
    },
    select: () => Promise.resolve(undefined),
    confirm: () => Promise.resolve(false),
  }
}

function runtimeOf(ui: CapturedUi): StatusUiRuntime {
  return { ui: () => ui, sessionId: () => "session-a", mode: () => "tui" }
}

function manualTimers(): StatusUiTimers & { run(): void } {
  const queued = new Map<number, () => void>()
  let nextHandle = 1
  return {
    set: (callback) => {
      const handle = nextHandle++
      queued.set(handle, callback)
      return handle
    },
    clear: (handle) => {
      if (typeof handle === "number") queued.delete(handle)
    },
    run: () => {
      const callbacks = [...queued.values()]
      queued.clear()
      for (const callback of callbacks) callback()
    },
  }
}

function collectingLogger(): StatusUiLogger & { readonly entries: string[] } {
  const entries: string[] = []
  return {
    entries,
    warn: (message) => {
      entries.push(message)
    },
  }
}

describe("createTaskStatusUi render fault containment", () => {
  it("#given a ui whose setWidget throws #when syncNow runs #then the fault is contained and logged once", () => {
    // given
    const logger = collectingLogger()
    const statusUi = createTaskStatusUi({
      manager: { list: () => [] },
      runtime: runtimeOf(throwingUi()),
      logger,
    })

    // when / then
    expect(() => statusUi.syncNow()).not.toThrow()
    expect(logger.entries).toEqual(["omo-task status widget render failed; frame skipped"])

    expect(() => statusUi.syncNow()).not.toThrow()
    expect(logger.entries).toHaveLength(1)
  })

  it("#given a debounced render whose widget write throws #when the timer fires #then the callback does not throw", () => {
    // given
    const timers = manualTimers()
    const logger = collectingLogger()
    const statusUi = createTaskStatusUi({
      manager: { list: () => [] },
      runtime: runtimeOf(throwingUi()),
      timers,
      logger,
    })

    // when
    statusUi.scheduleSync()

    // then
    expect(() => timers.run()).not.toThrow()
    expect(logger.entries).toHaveLength(1)
    statusUi.dispose()
  })
})
