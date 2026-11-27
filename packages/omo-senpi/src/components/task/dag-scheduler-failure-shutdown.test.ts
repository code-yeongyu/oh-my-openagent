// A scheduler-failure hand-off that is still waiting for the run when the session shuts down (#15125):
// the shutdown holds the run's reservation until its own pause is written, recovery is closed by then,
// so the hand-off ends with nothing claimed, parked or appended after the shutdown's pause.
import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"

import {
  createDagRecovery,
  type DagRunId,
  type DagRunRecordV1,
  type DagScheduler,
} from "@oh-my-opencode/senpi-task/dag"

import { runId } from "../../../../senpi-task/src/dag/__fixtures__/reattached-run"
import { createDagRecoverySweeps } from "./dag-recovery-sweeps"
import { within } from "./dag-runtime-recovery.test-support"
import { createShutdownPause } from "./dag-runtime-shutdown"
import { failedSchedulerRun, THIS_HOST } from "./dag-scheduler-failure.test-support"
import type { OwnedScheduler } from "./dag-scheduler-registry"

const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

/** The handler wired to a real recovery and its real sweeps, and a shutdown held at a gate. */
function shuttingDown(failuresBefore: number) {
  let sweeps: ReturnType<typeof createDagRecoverySweeps> | undefined
  let earlier = failuresBefore
  const run = failedSchedulerRun(cleanupRoots, {
    recover: async (sessionId) => {
      // A failure before this test's one: its recovery took the run, and that scheduler has since ended.
      if (earlier-- > 0) return [{ runId, kind: "resumed" }]
      return (await sweeps?.recover({ sessionId })) ?? []
    },
  })
  const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined }
  const recovery = createDagRecovery({
    store: run.base,
    taskManager: run.children,
    hostPid: THIS_HOST,
    isProcessAlive: (pid) => pid === THIS_HOST,
    isRunHeldInProcess: () => false,
    reservations: run.reservations,
  })
  sweeps = createDagRecoverySweeps({
    leaseWatch: {},
    logger: quiet,
    install: (scope) => recovery.installPausedRuns(scope.sessionId, () => undefined),
    afterSweep: () => undefined,
    activeSessionId: () => run.running.parentSessionId,
    onRecovered: () => undefined,
  })
  let openRetirement = (): void => undefined
  const retirement = new Promise<void>((resolve) => (openRetirement = resolve))
  let markRetiring = (): void => undefined
  const retiring = new Promise<void>((resolve) => (markRetiring = resolve))
  const otherScheduler = {
    suspend: async () => {
      markRetiring()
      await retirement
    },
  } as unknown as DagScheduler
  const schedulers = new Map<DagRunId, OwnedScheduler>([
    ["run-other" as DagRunId, { scheduler: otherScheduler, running: Promise.resolve({} as DagRunRecordV1) }],
  ])
  const shutdown = createShutdownPause({
    sweeps,
    reservations: run.reservations,
    schedulers,
    recovery,
    sessionId: () => run.running.parentSessionId,
    sessionRuns: () => [runId],
  })
  return { run, shutdown, retiring, openRetirement }
}

async function failDuringShutdown(failuresBefore: number) {
  const s = shuttingDown(failuresBefore)
  for (let i = 0; i < failuresBefore; i += 1) {
    await s.run.fail()
    s.run.state.held = false
  }
  const pausing = s.shutdown()
  await within(s.retiring, "the shutdown holding the run")
  const handing = s.run.fail()
  s.openRetirement()
  await within(pausing, "the shutdown")
  await within(handing, "the hand-off ending")
  const events = s.run.events()
  return { ...s, events, shutdownPause: events.findIndex((event) => event.type === "dag.run.paused") }
}

describe("DAG scheduler-failure hand-off waiting when the session shuts down", () => {
  test("#given a first failure while the shutdown holds the run #when the shutdown releases it #then the hand-off ends: nothing claimed, nothing after the shutdown's pause, no lease", async () => {
    const s = await failDuringShutdown(0)
    expect(s.shutdownPause).toBe(s.events.length - 1)
    expect(s.events.at(-1)).toEqual(expect.objectContaining({ type: "dag.run.paused", reason: "session_shutdown" }))
    expect(s.events.map((event) => event.type)).not.toContain("dag.run.resumed")
    expect(s.run.read()?.leaseHolderPid).toBeUndefined()
    expect(s.run.read()?.status).toBe("paused")
  })

  test("#given a second failure while the shutdown holds the run #when the shutdown releases it #then no park is written, the outcome is logged, nothing after the shutdown's pause", async () => {
    const s = await failDuringShutdown(1)
    expect(s.shutdownPause).toBe(s.events.length - 1)
    expect(s.events.at(-1)).toEqual(expect.objectContaining({ type: "dag.run.paused", reason: "session_shutdown" }))
    expect(s.run.read()?.leaseHolderPid).toBeUndefined()
    expect(s.run.logs.map((entry) => entry.message)).toContain(
      "omo-senpi dag run needs no hand-off after its scheduler failed",
    )
  })
})
