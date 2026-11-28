// The first-failure hand-off decides from recovery's own answer for its run (#15125): a claim that answered
// busy because another operation reserved the run after the hand-off's wait, and released it before the
// sweep ended, is asked again; a real refusal ends the hand-off after one ask.
import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"

import { createDagRecovery, type InstalledDagRun } from "@oh-my-opencode/senpi-task/dag"

import { owner, runId, taskRecord } from "../../../../senpi-task/src/dag/__fixtures__/reattached-run"
import type { DagRunReservation } from "../../../../senpi-task/src/dag/run-reservations"
import { createDagRecoverySweeps } from "./dag-recovery-sweeps"
import { within } from "./dag-runtime-recovery.test-support"
import { failedSchedulerRun, OTHER_HOST, THIS_HOST } from "./dag-scheduler-failure.test-support"

const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function withRealRecovery() {
  let sweeps: ReturnType<typeof createDagRecoverySweeps> | undefined
  const run = failedSchedulerRun(cleanupRoots, {
    recover: async (sessionId) => sweeps?.recover({ sessionId }) ?? [],
  })
  const installed: InstalledDagRun[] = []
  const recovery = createDagRecovery({
    store: run.base,
    taskManager: run.children,
    hostPid: THIS_HOST,
    isProcessAlive: (pid) => pid === THIS_HOST || pid === OTHER_HOST,
    isRunHeldInProcess: () => run.state.held,
    reservations: run.reservations,
  })
  const asked = { sweeps: 0 }
  const lateSend: { reservation?: DagRunReservation } = {}
  sweeps = createDagRecoverySweeps({
    leaseWatch: {},
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
    install: (scope) => {
      asked.sweeps += 1
      return recovery.installPausedRuns(scope.sessionId, (adopted) => {
        installed.push(adopted)
        run.state.held = true
        adopted.release()
      })
    },
    // The send that reserved the run behind the hand-off's back ends while recovery is still finishing.
    afterSweep: () => lateSend.reservation?.release(),
    activeSessionId: () => run.running.parentSessionId,
    onRecovered: () => undefined,
  })
  return { run, installed, asked, lateSend }
}

describe("DAG scheduler-failure hand-off and recovery's answer for its run", () => {
  test("#given a send that reserves the run after the hand-off's wait and releases it before the sweep ends #when the first failure is handed to recovery #then the run is asked for again and claimed, and a later failure parks it", async () => {
    // given
    const s = withRealRecovery()
    const sendHoldingTheRun = s.run.reservations.reserve(runId, "send")
    // A send queued on the same release, ahead of the hand-off: it takes the run the moment it is free.
    const sendTakesTheRun = s.run.reservations.whenFree(runId).then(() => {
      s.lateSend.reservation = s.run.reservations.reserve(runId, "send")
    })

    // when
    const handing = s.run.fail()
    sendHoldingTheRun?.release()
    await within(sendTakesTheRun, "the second send reserving the run")
    await within(handing, "the hand-off")

    // then
    expect(s.lateSend.reservation).toBeDefined()
    expect(s.run.events().map((event) => event.type)).toContain("dag.run.resumed")
    expect(s.installed).toHaveLength(1)
    expect(s.asked.sweeps).toBe(2)
    expect(s.run.children.startOwnedCalls).toEqual([])
    expect(s.run.read()).toEqual(
      expect.objectContaining({
        status: "running",
        leaseHolderPid: THIS_HOST,
        nodes: [expect.objectContaining({ id: "only", state: "running", taskId: "task-only" })],
      }),
    )

    // and the count still reads "first failure handled": the recovered scheduler's failure parks the run
    await within(s.installed[0]?.scheduler.suspend() ?? Promise.resolve(), "the recovered scheduler ending")
    s.run.state.held = false
    await within(s.run.fail(), "the second hand-off")
    expect(s.run.events().at(-1)).toEqual(
      expect.objectContaining({ type: "dag.run.paused", reason: "scheduler_failed" }),
    )
    expect(s.asked.sweeps).toBe(2)
  })

  test("#given recovery refuses the run for a real reason (a live foreign child owner) #when the first failure is handed to recovery #then the hand-off stops after one ask and logs the reason", async () => {
    // given
    const s = withRealRecovery()
    s.run.children.add({ ...taskRecord(owner("only"), "running", "task-only"), host_pid: OTHER_HOST })

    // when
    await within(s.run.fail(), "the hand-off")

    // then
    expect(s.asked.sweeps).toBe(1)
    expect(s.installed).toHaveLength(0)
    expect(s.run.events().map((event) => event.type)).not.toContain("dag.run.resumed")
    expect(s.run.logs).toContainEqual(
      expect.objectContaining({
        level: "info",
        fields: expect.objectContaining({ runId, reason: "live_lease", holderPid: OTHER_HOST }),
      }),
    )
  })
})
