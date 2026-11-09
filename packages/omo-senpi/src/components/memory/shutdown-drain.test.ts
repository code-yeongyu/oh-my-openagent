import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { realpathSync } from "node:fs"
import { rmEfaultTolerant } from "./teardown.test-support"

import { TranscriptJournal, resolveMemoryIdentity, type TranscriptEntry } from "@oh-my-opencode/memory-core"

import { SettingsManager } from "../../senpi-test-runtime"
import type { ComponentLogger } from "../../extension/types"
import { createMemoryComponent } from "./index"
import {
  componentContext,
  loadedMemoryConfig,
  memorySettings,
  MemoryFakeExtensionAPI,
  sessionContext,
} from "./memory.test-support"
import {
  SESSION_SHUTDOWN_DRAIN_BUDGET_MS,
  createShutdownDrain,
  shutdownDeadlineAt,
  type ShutdownDrainSteps,
} from "./shutdown-drain"

const SESSION = "session-drain"
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => rmEfaultTolerant(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })),
  )
})

type LogCall = { message: string; details: unknown }

function recordingLogger(): {
  logger: ComponentLogger
  warnings: string[]
  infos: LogCall[]
  warningCalls: LogCall[]
  errorCalls: LogCall[]
} {
  const warnings: string[] = []
  const infos: LogCall[] = []
  const warningCalls: LogCall[] = []
  const errorCalls: LogCall[] = []
  return {
    warnings,
    infos,
    warningCalls,
    errorCalls,
    logger: {
      info: (message, details) => {
        infos.push({ message, details })
      },
      warn: (message, details) => {
        warnings.push(message)
        warningCalls.push({ message, details })
      },
      error: (message, details) => {
        errorCalls.push({ message, details })
      },
    },
  }
}

function recordingSteps(order: string[], overrides: Partial<ShutdownDrainSteps> = {}): ShutdownDrainSteps {
  return {
    flushJournal: async () => {
      order.push("a")
    },
    enqueueFinalDelta: async () => {
      order.push("b")
    },
    flushSkillsUsage: async () => {
      order.push("c-prime")
    },
    ...overrides,
  }
}

/** Deadline far past any clock reading in these tests: the budget never bites. */
function openBudget(now: number): number {
  return now + 1_000_000
}

function entry(kind: "user" | "assistant", messageId: string): TranscriptEntry {
  return {
    kind,
    text: `${kind} ${messageId}`,
    captured_at: "2026-08-10T00:00:00.000Z",
    source_line_id: `${messageId}:${kind}`,
    source_message_id: messageId,
  }
}

describe("session shutdown drain budget", () => {
  test("#given the drain budget #when a handler derives its deadline #then it is exactly 1500ms after the start instant", () => {
    // given
    const startedAt = 10_000

    // when
    const deadlineAt = shutdownDeadlineAt(() => startedAt)

    // then
    expect(SESSION_SHUTDOWN_DRAIN_BUDGET_MS).toBe(1500)
    expect(deadlineAt).toBe(11_500)
  })

  test("#given a quit shutdown with facts threshold met #when the drain runs #then it enqueues but never launches facts before evaluators", async () => {
    // given
    const order: string[] = []
    const signals: AbortSignal[] = []
    const drain = createShutdownDrain({ steps: recordingSteps(order) })
    drain.registerEvaluator(({ signal }) => {
      order.push("d1")
      signals.push(signal)
    })
    drain.registerEvaluator(async () => {
      order.push("d2")
    })

    // when
    await drain.run({ reason: "quit", sessionId: SESSION, deadlineAt: openBudget(0), now: () => 0 })

    // then
    expect(order).toEqual(["a", "b", "c-prime", "d1", "d2"])
    expect(signals).toHaveLength(1)
    expect(signals[0]?.aborted).toBe(true)
  })

  test("#given a reload shutdown #when the drain runs #then only the journal flush and the final enqueue run", async () => {
    // given
    const order: string[] = []
    const drain = createShutdownDrain({ steps: recordingSteps(order) })
    drain.registerEvaluator(() => {
      order.push("d1")
    })

    // when
    for (const reason of ["reload", "new", "resume", "fork"] as const) {
      await drain.run({ reason, sessionId: SESSION, deadlineAt: openBudget(0), now: () => 0 })
    }

    // then
    expect(order).toEqual(["a", "b", "a", "b", "a", "b", "a", "b"])
  })

  test("#given an in-drain step exhausts the budget #when quit drains #then it warns with timing and completed steps", async () => {
    // given
    const order: string[] = []
    const { logger, warningCalls } = recordingLogger()
    let clock = 0
    const stalled = new Promise<void>(() => {})
    const drain = createShutdownDrain({
      logger,
      steps: recordingSteps(order, {
        enqueueFinalDelta: async () => {
          clock = SESSION_SHUTDOWN_DRAIN_BUDGET_MS
          await stalled
        },
      }),
    })

    // when
    await drain.run({
      reason: "quit",
      sessionId: SESSION,
      deadlineAt: SESSION_SHUTDOWN_DRAIN_BUDGET_MS,
      now: () => clock,
    })

    // then
    expect(warningCalls).toHaveLength(1)
    expect(warningCalls[0]).toEqual({
      message: "memory shutdown drain hit its budget",
      details: {
        step: "facts-enqueue",
        reason: "quit",
        sessionId: SESSION,
        remainingMs: 0,
        completedSteps: ["journal-flush"],
      },
    })
  })

  test("#given the budget is already spent when the drain starts #when quit drains #then the skipped journal flush raises an error-level alarm instead of a warning", async () => {
    // given
    const order: string[] = []
    const { logger, warningCalls, errorCalls } = recordingLogger()
    const drain = createShutdownDrain({ logger, steps: recordingSteps(order) })

    // when
    await drain.run({
      reason: "quit",
      sessionId: SESSION,
      deadlineAt: SESSION_SHUTDOWN_DRAIN_BUDGET_MS,
      now: () => SESSION_SHUTDOWN_DRAIN_BUDGET_MS,
    })

    // then: a journal flush that never started is silent data loss, so it must be observable as
    // an alarm-grade event distinct from the budget warnings optional steps emit.
    expect(order).toEqual([])
    expect(errorCalls).toEqual([
      {
        message: "memory shutdown drain skipped the journal flush",
        details: {
          step: "journal-flush",
          reason: "quit",
          sessionId: SESSION,
          remainingMs: 0,
          completedSteps: [],
        },
      },
    ])
    expect(warningCalls).toHaveLength(0)
  })

  test("#given the journal flush itself stalls past the deadline #when quit drains #then the aborted flush raises the error-level alarm", async () => {
    // given
    const order: string[] = []
    const { logger, warningCalls, errorCalls } = recordingLogger()
    let clock = 0
    const stalled = new Promise<void>(() => {})
    const drain = createShutdownDrain({
      logger,
      steps: recordingSteps(order, {
        flushJournal: async () => {
          order.push("a")
          clock = SESSION_SHUTDOWN_DRAIN_BUDGET_MS
          await stalled
        },
      }),
    })

    // when
    await drain.run({
      reason: "quit",
      sessionId: SESSION,
      deadlineAt: SESSION_SHUTDOWN_DRAIN_BUDGET_MS,
      now: () => clock,
    })

    // then
    expect(order).toEqual(["a"])
    expect(errorCalls).toHaveLength(1)
    expect(errorCalls[0]?.message).toBe("memory shutdown drain skipped the journal flush")
    expect(warningCalls).toHaveLength(0)
  })

  test("#given only optional tail work is dropped #when the journal flush completes #then no journal-loss alarm fires", async () => {
    // given
    const order: string[] = []
    const { logger, infos, errorCalls } = recordingLogger()
    let clock = 0
    const drain = createShutdownDrain({
      logger,
      steps: recordingSteps(order, {
        flushSkillsUsage: async () => {
          order.push("c-prime")
          clock = SESSION_SHUTDOWN_DRAIN_BUDGET_MS
        },
      }),
    })
    let evaluated = false
    drain.registerEvaluator(() => {
      evaluated = true
    })

    // when
    await drain.run({
      reason: "quit",
      sessionId: SESSION,
      deadlineAt: SESSION_SHUTDOWN_DRAIN_BUDGET_MS,
      now: () => clock,
    })

    // then: the benign deferral line keeps its info severity and its message, so operator
    // monitors can alert on the journal-loss alarm without matching evaluator drops.
    expect(order).toEqual(["a", "b", "c-prime"])
    expect(evaluated).toBe(false)
    expect(errorCalls).toHaveLength(0)
    expect(infos[0]?.message).toBe("memory shutdown drain deferred optional work")
  })

  test("#given the budget is consumed before shutdown evaluation #when quit drains #then optional work is deferred at info severity", async () => {
    // given
    const order: string[] = []
    const { logger, infos, warningCalls } = recordingLogger()
    let clock = 0
    const drain = createShutdownDrain({
      logger,
      steps: recordingSteps(order, {
        flushSkillsUsage: async () => {
          order.push("c-prime")
          clock = SESSION_SHUTDOWN_DRAIN_BUDGET_MS
        },
      }),
    })
    let evaluated = false
    drain.registerEvaluator(() => {
      evaluated = true
    })

    // when
    await drain.run({
      reason: "quit",
      sessionId: SESSION,
      deadlineAt: SESSION_SHUTDOWN_DRAIN_BUDGET_MS,
      now: () => clock,
    })

    // then
    expect(evaluated).toBe(false)
    expect(infos).toEqual([
      {
        message: "memory shutdown drain deferred optional work",
        details: {
          step: "shutdown-evaluator",
          reason: "quit",
          sessionId: SESSION,
          remainingMs: 0,
          completedSteps: ["journal-flush", "facts-enqueue", "skills-usage-flush"],
        },
      },
    ])
    expect(warningCalls).toHaveLength(0)
  })

  test("#given a step that stalls two seconds on the injected clock #when quit drains #then it returns inside the budget and no later step starts", async () => {
    // given
    const order: string[] = []
    const { logger, warnings } = recordingLogger()
    let clock = 0
    let releaseStall: (() => void) | undefined
    const stalled = new Promise<void>((resolve) => {
      releaseStall = resolve
    })
    const drain = createShutdownDrain({
      logger,
      steps: recordingSteps(order, {
        enqueueFinalDelta: async () => {
          order.push("b")
          clock += 2_000
          await stalled
          order.push("b-late")
        },
      }),
    })
    drain.registerEvaluator(() => {
      order.push("d1")
    })
    const startedAt = clock
    const deadlineAt = shutdownDeadlineAt(() => startedAt)

    // when
    const realStart = Date.now()
    await drain.run({ reason: "quit", sessionId: SESSION, deadlineAt, now: () => clock })
    const elapsed = Date.now() - realStart

    // then
    expect(elapsed).toBeLessThan(SESSION_SHUTDOWN_DRAIN_BUDGET_MS)
    expect(order).toEqual(["a", "b"])
    expect(warnings).toHaveLength(1)
    releaseStall?.()
    await stalled
  })

  test("#given an aborted budget #when the stalled step finally settles #then no step that had not started ever starts", async () => {
    // given
    const order: string[] = []
    let clock = 0
    let releaseStall: (() => void) | undefined
    const stalled = new Promise<void>((resolve) => {
      releaseStall = resolve
    })
    let observedSignal: AbortSignal | undefined
    const drain = createShutdownDrain({
      steps: recordingSteps(order, {
        flushJournal: async (_sessionId, signal) => {
          order.push("a")
          observedSignal = signal
          clock += 2_000
          await stalled
        },
      }),
    })
    drain.registerEvaluator(() => {
      order.push("d1")
    })

    // when
    await drain.run({ reason: "quit", sessionId: SESSION, deadlineAt: shutdownDeadlineAt(() => 0), now: () => clock })
    releaseStall?.()
    await stalled

    // then
    expect(observedSignal?.aborted).toBe(true)
    expect(order).toEqual(["a"])
  })

  test("#given an evaluator that throws #when quit drains #then the throw is logged and the next evaluator still runs", async () => {
    // given
    const order: string[] = []
    const { logger, warnings } = recordingLogger()
    const drain = createShutdownDrain({ logger, steps: recordingSteps(order) })
    drain.registerEvaluator(() => {
      throw new Error("evaluator exploded")
    })
    drain.registerEvaluator(() => {
      order.push("d2")
    })

    // when
    await drain.run({ reason: "quit", sessionId: SESSION, deadlineAt: openBudget(0), now: () => 0 })

    // then
    expect(order).toEqual(["a", "b", "c-prime", "d2"])
    expect(warnings).toHaveLength(1)
  })

  test("#given a bound session with journal rows and facts threshold met #when session_shutdown fires #then entries stay queued and no facts launch is invoked", async () => {
    // given
    const root = realpathSync.native(await mkdtemp(join(tmpdir(), "omo-memory-shutdown-")))
    tempDirs.push(root)
    const cwd = join(root, "project")
    const env = { OMO_MEMORY_HOME: join(root, "memory") }
    const identity = resolveMemoryIdentity("drain-agent", cwd, env)
    const pi = new MemoryFakeExtensionAPI()
    createMemoryComponent({
      env,
      loadConfig: () => loadedMemoryConfig(memorySettings({ agent: "drain-agent" })),
      now: () => 0,
      resolveCwd: () => cwd,
    }).register(pi, componentContext())
    await pi.dispatch("session_start", {}, sessionContext({ sessionId: SESSION }))
    const journal = new TranscriptJournal({ journalDir: join(identity.paths.transcripts, SESSION) })
    await journal.append([entry("user", "m1"), entry("assistant", "m1")])

    // when
    await pi.dispatch(
      "session_shutdown",
      { type: "session_shutdown", reason: "quit" },
      sessionContext({ sessionId: SESSION }),
    )

    // then
    const queued = await readdir(identity.paths.factsQueue).catch(() => [] as string[])
    expect(queued.filter((name) => name.endsWith(".json") && name !== "consumed.json")).toHaveLength(1)
  })

  test("#given a memory home that is not a directory #when first-user-settle reconcile rejects #then it is logged instead of crashing the host", async () => {
    // given
    const root = realpathSync.native(await mkdtemp(join(tmpdir(), "omo-memory-shutdown-")))
    tempDirs.push(root)
    await writeFile(join(root, "memory"), "not a directory", "utf8")
    const pi = new MemoryFakeExtensionAPI()
    const ctx = componentContext()
    createMemoryComponent({
      env: { OMO_MEMORY_HOME: join(root, "memory") },
      loadConfig: () => loadedMemoryConfig(memorySettings({ facts: { enabled: false, debounce_settles: 4 } })),
      resolveCwd: () => join(root, "project"),
    }).register(pi, ctx)

    // when
    const eventCtx = sessionContext({ sessionId: SESSION })
    await pi.dispatch("session_start", {}, eventCtx)
    await pi.dispatch("input", { source: "interactive", inputId: "reconcile-input", text: "Continue." }, eventCtx)
    await pi.dispatch("input_disposition", { inputId: "reconcile-input", disposition: "started" }, eventCtx)
    await pi.dispatch("agent_settled", {}, eventCtx)

    // then
    expect(ctx.logs.filter((entry) => entry.message === "memory bind-time reconcile failed")).toHaveLength(1)
  })

  test("#given a pre-drain await that never resolves #when it is raced detached #then the handler returns at the deadline with the budget warning and the steps after it still run", async () => {
    // given
    const order: string[] = []
    const { logger, warningCalls } = recordingLogger()
    const input = { reason: "quit", sessionId: SESSION, deadlineAt: 50, now: () => 0 } as const
    const drain = createShutdownDrain({ logger, steps: recordingSteps(order) })
    drain.registerEvaluator(() => {
      order.push("d1")
    })
    let entered = false

    // when
    const raced = await drain.raceDetached(input, "kibitzer-shutdown", () => {
      entered = true
      return new Promise<void>(() => {})
    })
    await drain.run(input, { journalFlushed: true })

    // then: the work was started (it owns the wake lease and the directory lock), the handler let
    // go of it at the deadline, and everything the drain still owes the session ran afterwards.
    expect(entered).toBe(true)
    expect(raced).toBe(false)
    expect(warningCalls).toEqual([
      {
        message: "memory shutdown drain hit its budget",
        details: {
          step: "kibitzer-shutdown",
          reason: "quit",
          sessionId: SESSION,
          remainingMs: 50,
          completedSteps: [],
        },
      },
    ])
    expect(order).toEqual(["b", "c-prime", "d1"])
  })

  test("#given a detached pre-drain await abandoned at the deadline #when it finally settles #then its continuation still runs to completion", async () => {
    // given
    const order: string[] = []
    const { logger } = recordingLogger()
    const drain = createShutdownDrain({ logger, steps: recordingSteps(order) })
    const release = Promise.withResolvers<void>()
    const released = Promise.withResolvers<string>()

    // when
    const raced = await drain.raceDetached(
      { reason: "quit", sessionId: SESSION, deadlineAt: 50, now: () => 0 },
      "kibitzer-shutdown",
      async () => {
        await release.promise
        released.resolve("lease released")
      },
    )

    // then: the continuation that hands the wake lease back is not cancelled by the deadline.
    expect(raced).toBe(false)
    release.resolve()
    expect(await released.promise).toBe("lease released")
  })

  test("#given a detached pre-drain await that rejects after the deadline #when it settles #then the failure is warned with its step instead of surfacing unhandled", async () => {
    // given
    const order: string[] = []
    const failures: LogCall[] = []
    const warned = Promise.withResolvers<LogCall>()
    const logger: ComponentLogger = {
      info: () => {},
      warn: (message, details) => {
        if (message !== "memory shutdown drain detached step failed") return
        failures.push({ message, details })
        warned.resolve({ message, details })
      },
      error: () => {},
    }
    const drain = createShutdownDrain({ logger, steps: recordingSteps(order) })
    const release = Promise.withResolvers<void>()

    // when
    await drain.raceDetached(
      { reason: "reload", sessionId: SESSION, deadlineAt: 50, now: () => 0 },
      "facts-cancel",
      async () => {
        await release.promise
        throw new Error("cancel exploded")
      },
    )
    release.resolve()

    // then
    expect(await warned.promise).toEqual({
      message: "memory shutdown drain detached step failed",
      details: { step: "facts-cancel", reason: "reload", sessionId: SESSION, error: "Error: cancel exploded" },
    })
    expect(failures).toHaveLength(1)
  })

  test("#given a detached pre-drain await that completes inside the budget #when a later one expires #then the completed step is reported as done", async () => {
    // given
    const order: string[] = []
    const { logger, warningCalls } = recordingLogger()
    const input = { reason: "quit", sessionId: SESSION, deadlineAt: 50, now: () => 0 } as const
    const drain = createShutdownDrain({ logger, steps: recordingSteps(order) })

    // when
    const first = await drain.raceDetached(input, "kibitzer-shutdown", async () => {
      order.push("kibitzer")
    })
    const second = await drain.raceDetached(input, "facts-cancel", () => new Promise<void>(() => {}))

    // then
    expect(first).toBe(true)
    expect(second).toBe(false)
    expect(order).toEqual(["kibitzer"])
    expect(warningCalls).toEqual([
      {
        message: "memory shutdown drain hit its budget",
        details: {
          step: "facts-cancel",
          reason: "quit",
          sessionId: SESSION,
          remainingMs: 50,
          completedSteps: ["kibitzer-shutdown"],
        },
      },
    ])
  })

  test("#given a step that rejects #when the drain runs #then the drain still completes the remaining steps", async () => {
    // given
    const order: string[] = []
    const { logger, warnings } = recordingLogger()
    const drain = createShutdownDrain({
      logger,
      steps: recordingSteps(order, {
        flushJournal: async () => {
          throw new Error("journal flush failed")
        },
      }),
    })

    // when
    await drain.run({ reason: "quit", sessionId: SESSION, deadlineAt: openBudget(0), now: () => 0 })

    // then
    expect(order).toEqual(["b", "c-prime"])
    expect(warnings).toHaveLength(1)
  })
})

// senpi bounds one `session_shutdown` handler with three settings whose DEFAULTS come from the host
// itself: a warn threshold, a per-handler hard timeout, and a total quit budget across handlers
// (senpi#3711). Users can retune each - `sessionShutdownHandlerWarnMs`,
// `sessionShutdownHandlerTimeoutMs`, `sessionShutdownQuitBudgetMs` - and 0 turns a bound off, so the
// fit below is stated against the defaults and read from the installed senpi rather than restated
// here: a senpi release that lowers a default under the drain budget must fail this test.
const senpiShutdownBudget = SettingsManager.inMemory({})

describe("session shutdown drain against senpi's per-handler cap", () => {
  test("#given senpi's session_shutdown handler defaults #when the drain budget is sized #then it sits below the warn threshold, the handler timeout and the quit budget", () => {
    // given
    const budget = SESSION_SHUTDOWN_DRAIN_BUDGET_MS

    // when: senpi's own numbers, read through senpi's own settings manager
    const warnMs = senpiShutdownBudget.getSessionShutdownHandlerWarnMs()
    const timeoutMs = senpiShutdownBudget.getSessionShutdownHandlerTimeoutMs()
    const quitBudgetMs = senpiShutdownBudget.getSessionShutdownQuitBudgetMs()

    // then: under the host's shipped defaults the drain, and the teardown that follows it inside the
    // same handler, finish before any of the three bounds can bite. omo adds no cap of its own.
    expect(warnMs).toBeGreaterThan(0)
    expect(timeoutMs).toBeGreaterThan(warnMs)
    expect(quitBudgetMs).toBeGreaterThan(0)
    expect(budget).toBeGreaterThan(0)
    expect(budget).toBeLessThan(warnMs)
    expect(budget).toBeLessThan(timeoutMs)
    expect(budget).toBeLessThan(quitBudgetMs)
  })

  test("#given several shutdown evaluators that all stall forever #when quit drains #then only the first is admitted and the run stays inside the budget", async () => {
    // given
    const order: string[] = []
    let clock = 0
    const drain = createShutdownDrain({ steps: recordingSteps(order) })
    for (let index = 1; index <= 3; index += 1) {
      drain.registerEvaluator(async () => {
        order.push(`d${index}`)
        clock = SESSION_SHUTDOWN_DRAIN_BUDGET_MS
        await new Promise<void>(() => {})
      })
    }

    // when
    await drain.run({ reason: "quit", sessionId: SESSION, deadlineAt: shutdownDeadlineAt(() => 0), now: () => clock })

    // then: the budget admits the first stalling handler only - d2 and d3 never start - so the drain
    // ends inside its own budget, which the test above pins under senpi's default bounds
    expect(order).toEqual(["a", "b", "c-prime", "d1"])
  })
})
