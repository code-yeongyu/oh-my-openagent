/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test"

import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { subagentSessions } from "../claude-code-session-state"
import { _resetForTesting as resetProcessCleanupForTesting } from "../background-agent/process-cleanup"
import { MonitorManager, createMonitorManager } from "./manager"
import type { MonitoredProcess } from "./process"
import type { MonitorCounters, MonitorRecord, OutputBatch } from "./types"

type FakeTimerHandle = number

interface FakeTimer {
  id: FakeTimerHandle
  fn: () => void
  ms: number
  cleared: boolean
}

interface FakeInjector {
  queueBatch(record: MonitorRecord, batch: OutputBatch): void
  flushMonitor(monitorId: string): Promise<void>
  queued: Array<{ record: MonitorRecord; batch: OutputBatch }>
  flushed: string[]
}

function createEmptyStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close()
    },
  })
}

function createNeverExitingProcess(killCalls: string[]): MonitoredProcess {
  return {
    kill(signal = "SIGTERM") {
      killCalls.push(signal)
    },
    exited: new Promise(() => {}),
    stdout: createEmptyStream(),
    stderr: createEmptyStream(),
  }
}

function createFakeScheduler(): {
  setTimer(fn: () => void, ms: number): FakeTimerHandle
  clearTimer(handle: FakeTimerHandle): void
  activeTimerCount(): number
  timers: FakeTimer[]
} {
  let nextId = 1
  const timers: FakeTimer[] = []

  return {
    setTimer(fn, ms) {
      const id = nextId
      nextId += 1
      timers.push({ id, fn, ms, cleared: false })
      return id
    },
    clearTimer(handle) {
      const timer = timers.find((entry) => entry.id === handle)
      if (timer) {
        timer.cleared = true
      }
    },
    activeTimerCount() {
      return timers.filter((timer) => !timer.cleared).length
    },
    timers,
  }
}

function createFakeInjector(): FakeInjector {
  return {
    queued: [],
    flushed: [],
    queueBatch(record, batch) {
      this.queued.push({ record, batch })
    },
    async flushMonitor(monitorId) {
      this.flushed.push(monitorId)
    },
  }
}

function createManagerHarness(opts: { maxMonitorsPerSession?: number; isBackgroundSession?: (sessionId: string) => boolean } = {}) {
  const killCallsByCommand = new Map<string, string[]>()
  const injectorsByMonitorId = new Map<string, FakeInjector>()
  const scheduler = createFakeScheduler()
  const spawnCalls: string[] = []

  const manager = new MonitorManager({
    pluginContext: unsafeTestValue({ client: {}, directory: "/repo" }),
    config: {
      max_monitors_per_session: opts.maxMonitorsPerSession ?? 3,
      max_runtime_ms: 60_000,
      batch_max_lines: 3,
      batch_max_bytes: 1024,
      flush_interval_ms: 1000,
      ring_max_lines: 20,
      line_max_bytes: 1024,
      pattern_max_length: 512,
    },
    deps: {
      randomId: (() => {
        let nextId = 1
        return () => `mon_test${nextId++}`
      })(),
      isBackgroundSession: opts.isBackgroundSession,
      spawnMonitoredProcess(input) {
        spawnCalls.push(input.command)
        const killCalls: string[] = []
        killCallsByCommand.set(input.command, killCalls)
        return createNeverExitingProcess(killCalls)
      },
      createInjector(record, scheduleFlush) {
        const injector = createFakeInjector()
        injectorsByMonitorId.set(record.id, injector)
        scheduleFlush(record.id, 1000, async () => {})
        return injector
      },
      scheduler: {
        setTimer: scheduler.setTimer,
        clearTimer: scheduler.clearTimer,
        now: () => 0,
      },
      registerManagerForCleanup: () => {},
      unregisterManagerForCleanup: () => {},
      log: () => {},
    },
  })

  return { manager, killCallsByCommand, injectorsByMonitorId, scheduler, spawnCalls }
}

async function startMonitor(manager: MonitorManager, command: string, sessionId: string): Promise<MonitorRecord> {
  return manager.start({
    command,
    label: command,
    parentSessionId: sessionId,
    parentMessageId: `msg-${command}`,
  })
}

async function expectRejectsWithMessage(promise: Promise<unknown>, message: string): Promise<void> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain(message)
    return
  }

  throw new Error(`Expected promise to reject with ${message}`)
}

function createCounters(): MonitorCounters {
  return {
    totalLines: 0,
    matchedLines: 0,
    unmatchedLines: 0,
    droppedMatched: 0,
    droppedUnmatched: 0,
    bytesDropped: 0,
    lastSequence: 0,
  }
}

async function drainMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

afterEach(() => {
  subagentSessions.clear()
  resetProcessCleanupForTesting()
})

describe("MonitorManager", () => {
  describe("#given a per-session monitor cap", () => {
    test("#when start would exceed max_monitors_per_session #then it rejects and spawns nothing extra", async () => {
      // given
      const { manager, spawnCalls } = createManagerHarness({ maxMonitorsPerSession: 3 })
      await startMonitor(manager, "cmd-1", "s1")
      await startMonitor(manager, "cmd-2", "s1")
      await startMonitor(manager, "cmd-3", "s1")

      // when
      const rejectedStart = manager.start({ command: "cmd-4", parentSessionId: "s1" })

      // then
      await expectRejectsWithMessage(rejectedStart, "max_monitors_per_session")
      expect(spawnCalls).toEqual(["cmd-1", "cmd-2", "cmd-3"])
      expect(manager.list("s1")).toHaveLength(3)
    })
  })

  describe("#given a running monitor", () => {
    test("#when stop is called twice #then it kills the process group once and remains stopped", async () => {
      // given
      const { manager, killCallsByCommand } = createManagerHarness()
      const record = await startMonitor(manager, "long-running", "s1")

      // when
      await manager.stop(record.id)
      await manager.stop(record.id)

      // then
      expect(killCallsByCommand.get("long-running")).toEqual(["SIGTERM"])
      expect(manager.get(record.id)?.status).toBe("stopped")
    })
  })

  describe("#given monitors in two parent sessions", () => {
    test("#when session.idle is handled #then it flushes only that session's injectors", async () => {
      // given
      const { manager, injectorsByMonitorId } = createManagerHarness()
      const s1Record = await startMonitor(manager, "s1-cmd", "s1")
      const s2Record = await startMonitor(manager, "s2-cmd", "s2")

      // when
      manager.handleEvent({ type: "session.idle", sessionId: "s1" })
      await Promise.resolve()

      // then
      expect(injectorsByMonitorId.get(s1Record.id)?.flushed).toEqual([s1Record.id])
      expect(injectorsByMonitorId.get(s2Record.id)?.flushed).toEqual([])
    })

    test("#when stopSessionMonitors runs #then it kills every monitor for that session only", async () => {
      // given
      const { manager, killCallsByCommand } = createManagerHarness()
      await startMonitor(manager, "s1-a", "s1")
      await startMonitor(manager, "s1-b", "s1")
      await startMonitor(manager, "s2-a", "s2")

      // when
      await manager.stopSessionMonitors("s1")

      // then
      expect(killCallsByCommand.get("s1-a")).toEqual(["SIGTERM"])
      expect(killCallsByCommand.get("s1-b")).toEqual(["SIGTERM"])
      expect(killCallsByCommand.get("s2-a")).toEqual([])
      expect(manager.list("s1")).toEqual([])
      expect(manager.list("s2").map((record) => record.status)).toEqual(["running"])
    })

    test("#when stopSessionMonitors runs #then it purges the session's monitor records from memory", async () => {
      // given
      const { manager } = createManagerHarness()
      await startMonitor(manager, "p1", "s1")
      await startMonitor(manager, "p2", "s1")
      await startMonitor(manager, "p3", "s1")
      const internal = manager as unknown as {
        monitors: Map<string, unknown>
        monitorsByParentSession: Map<string, Set<string>>
      }

      // when
      await manager.stopSessionMonitors("s1")

      // then
      expect(internal.monitors.size).toBe(0)
      expect(internal.monitorsByParentSession.get("s1")).toBeUndefined()
    })

    test("#when many monitors are started and stopped in one live session #then terminal records stay bounded", async () => {
      // given
      const { manager } = createManagerHarness({ maxMonitorsPerSession: 2 })
      const internal = manager as unknown as { monitors: Map<string, unknown> }

      // when
      for (let index = 0; index < 6; index += 1) {
        const record = await startMonitor(manager, `short-${index}`, "s1")
        await manager.stop(record.id)
      }

      // then
      expect(internal.monitors.size).toBeLessThanOrEqual(2)
    })
  })

  describe("#given remaining monitors and active timers", () => {
    test("#when shutdown runs #then every process group is killed and timers are cleared", async () => {
      // given
      const { manager, killCallsByCommand, scheduler } = createManagerHarness()
      await startMonitor(manager, "s1-a", "s1")
      await startMonitor(manager, "s2-a", "s2")
      expect(scheduler.activeTimerCount()).toBeGreaterThan(0)

      // when
      await manager.shutdown()

      // then
      expect(killCallsByCommand.get("s1-a")).toEqual(["SIGTERM"])
      expect(killCallsByCommand.get("s2-a")).toEqual(["SIGTERM"])
      expect(scheduler.activeTimerCount()).toBe(0)
      expect(manager.list("s1")).toEqual([])
      expect(manager.list("s2")).toEqual([])
    })
  })

  describe("#given a background session id", () => {
    test("#when start is requested #then it rejects before spawning", async () => {
      // given
      const { manager, spawnCalls } = createManagerHarness({ isBackgroundSession: (sessionId) => sessionId === "bg-session" })

      // when
      const rejectedStart = manager.start({ command: "should-not-run", parentSessionId: "bg-session" })

      // then
      await expectRejectsWithMessage(rejectedStart, "primary session")
      expect(spawnCalls).toEqual([])
    })

    test("#when a session is tracked as a subagent #then start rejects by default", async () => {
      // given
      const { manager, spawnCalls } = createManagerHarness()
      subagentSessions.add("subagent-session")

      // when
      const rejectedStart = manager.start({ command: "should-not-run", parentSessionId: "subagent-session" })

      // then
      await expectRejectsWithMessage(rejectedStart, "primary session")
      expect(spawnCalls).toEqual([])
    })
  })

  describe("#given a factory", () => {
    test("#when createMonitorManager runs #then it returns a MonitorManager instance", () => {
      // given
      const registerManagerForCleanup = mock(() => {})

      // when
      const manager = createMonitorManager({
        pluginContext: unsafeTestValue({ client: {}, directory: "/repo" }),
        deps: {
          registerManagerForCleanup,
          unregisterManagerForCleanup: () => {},
          log: () => {},
        },
      })

      // then
      expect(manager).toBeInstanceOf(MonitorManager)
      expect(registerManagerForCleanup).toHaveBeenCalledTimes(1)
      expect(manager.getOutput("missing", { stream: "all" })).toEqual({ lines: [], counters: createCounters() })
    })
  })

  describe("#given a monitor whose process exits", () => {
    function createExitHarness() {
      let resolveExit!: (result: { code: number | null; signal: string | null }) => void
      let rejectExit!: (error: unknown) => void
      const exited = new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
        resolveExit = resolve
        rejectExit = reject
      })
      const flushed: string[] = []
      const scheduler = createFakeScheduler()
      const manager = new MonitorManager({
        pluginContext: unsafeTestValue({ client: {}, directory: "/repo" }),
        config: {
          max_monitors_per_session: 3,
          max_runtime_ms: 60_000,
          batch_max_lines: 3,
          batch_max_bytes: 1024,
          flush_interval_ms: 1000,
          ring_max_lines: 20,
          line_max_bytes: 1024,
          pattern_max_length: 512,
        },
        deps: {
          randomId: () => "mon_exit",
          spawnMonitoredProcess() {
            return {
              kill() {},
              exited,
              stdout: createEmptyStream(),
              stderr: createEmptyStream(),
            }
          },
          createInjector() {
            return {
              queueBatch() {},
              async flushMonitor(monitorId: string) {
                flushed.push(monitorId)
              },
            }
          },
          scheduler: {
            setTimer: scheduler.setTimer,
            clearTimer: scheduler.clearTimer,
            now: () => 0,
          },
          registerManagerForCleanup: () => {},
          unregisterManagerForCleanup: () => {},
          log: () => {},
        },
      })
      return { manager, resolveExit, rejectExit, flushed }
    }

    test("#when the process exits naturally #then the manager flushes the injector for final delivery", async () => {
      // given
      const { manager, resolveExit, flushed } = createExitHarness()
      const record = await startMonitor(manager, "exiting-cmd", "s1")

      // when
      resolveExit({ code: 0, signal: null })
      await drainMicrotasks()

      // then
      expect(flushed).toContain(record.id)
    })

    test("#when the process exit rejects #then the manager still flushes the injector for final delivery", async () => {
      // given
      const { manager, rejectExit, flushed } = createExitHarness()
      const record = await startMonitor(manager, "failing-cmd", "s1")

      // when
      rejectExit(new Error("spawn failure"))
      await drainMicrotasks()

      // then
      expect(flushed).toContain(record.id)
    })
  })
})
