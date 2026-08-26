import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { realpathSync } from "node:fs"
import { rmEfaultTolerant } from "./teardown.test-support"

import { TranscriptJournal, resolveMemoryIdentity, type TranscriptEntry } from "@oh-my-opencode/memory-core"

import type { ComponentLogger } from "../../extension/types"
import { createMemoryComponent } from "./index"
import { componentContext, loadedMemoryConfig, memorySettings, MemoryFakeExtensionAPI, sessionContext } from "./memory.test-support"
import {
  SESSION_SHUTDOWN_DRAIN_BUDGET_MS,
  createShutdownDrain,
  shutdownDeadlineAt,
  type ShutdownDrainSteps,
} from "./shutdown-drain"

const SESSION = "session-drain"
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rmEfaultTolerant(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })))
})

function recordingLogger(): { logger: ComponentLogger; warnings: string[] } {
  const warnings: string[] = []
  return {
    warnings,
    logger: {
      info: () => {},
      warn: (message) => { warnings.push(message) },
      error: () => {},
    },
  }
}

function recordingSteps(order: string[], overrides: Partial<ShutdownDrainSteps> = {}): ShutdownDrainSteps {
  return {
    flushJournal: async () => { order.push("a") },
    enqueueFinalDelta: async () => { order.push("b") },
    flushSkillsUsage: async () => { order.push("c-prime") },
    launchFacts: async () => { order.push("c") },
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

  test("#given a quit shutdown #when the drain runs #then steps run in the a, b, c-prime, c, d order", async () => {
    // given
    const order: string[] = []
    const signals: AbortSignal[] = []
    const drain = createShutdownDrain({ steps: recordingSteps(order) })
    drain.registerEvaluator(({ signal }) => { order.push("d1"); signals.push(signal) })
    drain.registerEvaluator(async () => { order.push("d2") })

    // when
    await drain.run({ reason: "quit", sessionId: SESSION, deadlineAt: openBudget(0), now: () => 0 })

    // then
    expect(order).toEqual(["a", "b", "c-prime", "c", "d1", "d2"])
    expect(signals).toHaveLength(1)
    expect(signals[0]?.aborted).toBe(true)
  })

  test("#given a reload shutdown #when the drain runs #then only the journal flush and the final enqueue run", async () => {
    // given
    const order: string[] = []
    const drain = createShutdownDrain({ steps: recordingSteps(order) })
    drain.registerEvaluator(() => { order.push("d1") })

    // when
    for (const reason of ["reload", "new", "resume", "fork"] as const) {
      await drain.run({ reason, sessionId: SESSION, deadlineAt: openBudget(0), now: () => 0 })
    }

    // then
    expect(order).toEqual(["a", "b", "a", "b", "a", "b", "a", "b"])
  })

  test("#given a step that stalls two seconds on the injected clock #when quit drains #then it returns inside the budget and no later step starts", async () => {
    // given
    const order: string[] = []
    const { logger, warnings } = recordingLogger()
    let clock = 0
    let releaseStall: (() => void) | undefined
    const stalled = new Promise<void>((resolve) => { releaseStall = resolve })
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
    drain.registerEvaluator(() => { order.push("d1") })
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
    const stalled = new Promise<void>((resolve) => { releaseStall = resolve })
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
    drain.registerEvaluator(() => { order.push("d1") })

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
    drain.registerEvaluator(() => { throw new Error("evaluator exploded") })
    drain.registerEvaluator(() => { order.push("d2") })

    // when
    await drain.run({ reason: "quit", sessionId: SESSION, deadlineAt: openBudget(0), now: () => 0 })

    // then
    expect(order).toEqual(["a", "b", "c-prime", "c", "d2"])
    expect(warnings).toHaveLength(1)
  })

  test("#given a bound session with journal rows #when session_shutdown fires #then the drain runs before the session is released", async () => {
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
    await pi.dispatch("session_shutdown", { type: "session_shutdown", reason: "quit" }, sessionContext({ sessionId: SESSION }))

    // then
    const queued = await readdir(identity.paths.factsQueue).catch(() => [] as string[])
    expect(queued.filter((name) => name.endsWith(".json") && name !== "consumed.json")).toHaveLength(1)
  })

  test("#given a memory home that is not a directory #when bind-time reconcile rejects #then it is logged instead of crashing the host", async () => {
    // given
    const root = realpathSync.native(await mkdtemp(join(tmpdir(), "omo-memory-shutdown-")))
    tempDirs.push(root)
    await writeFile(join(root, "memory"), "not a directory", "utf8")
    const pi = new MemoryFakeExtensionAPI()
    const ctx = componentContext()
    let signalWarn: ((message: string) => void) | undefined
    const warned = new Promise<string>((resolve) => { signalWarn = resolve })
    const baseWarn = ctx.logger.warn
    ctx.logger.warn = (message, details) => {
      baseWarn(message, details)
      signalWarn?.(message)
    }
    createMemoryComponent({
      env: { OMO_MEMORY_HOME: join(root, "memory") },
      loadConfig: () => loadedMemoryConfig(memorySettings()),
      resolveCwd: () => join(root, "project"),
    }).register(pi, ctx)

    // when
    await pi.dispatch("session_start", {}, sessionContext({ sessionId: SESSION }))
    const message = await Promise.race([
      warned,
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("waited 5s for the bind-time reconcile warning, never fired")), 5_000)
      }),
    ])

    // then
    expect(message).toBe("memory bind-time reconcile failed")
  })

  test("#given a step that rejects #when the drain runs #then the drain still completes the remaining steps", async () => {
    // given
    const order: string[] = []
    const { logger, warnings } = recordingLogger()
    const drain = createShutdownDrain({
      logger,
      steps: recordingSteps(order, {
        flushJournal: async () => { throw new Error("journal flush failed") },
      }),
    })

    // when
    await drain.run({ reason: "quit", sessionId: SESSION, deadlineAt: openBudget(0), now: () => 0 })

    // then
    expect(order).toEqual(["b", "c-prime", "c"])
    expect(warnings).toHaveLength(1)
  })
})
