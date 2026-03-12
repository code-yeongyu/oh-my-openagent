import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  claimNextTeamTask,
  initializeTeamRuntime,
  markTeamMailboxMessageDelivered,
  requestTeamShutdown,
  transitionTeamTask,
} from "./runtime"
import { getTeamStatePath, readTeamRuntimeState } from "./state"

describe("team-mode runtime", () => {
  const testDir = join(tmpdir(), `team-mode-runtime-${Date.now()}`)
  const planPath = join(testDir, ".sisyphus/plans/sample-plan.md")

  beforeEach(() => {
    mkdirSync(join(testDir, ".sisyphus/plans"), { recursive: true })
    writeFileSync(planPath, [
      "# Sample Plan",
      "",
      "- [ ] First task",
      "- [ ] Second task",
    ].join("\n"))
  })

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  test("#given a new plan #when team runtime is initialized #then durable team state and boulder-safe metadata exist", () => {
    const runtime = initializeTeamRuntime({
      directory: testDir,
      leaderSessionId: "session-1",
      planPath,
      planName: "sample-plan",
      workerCount: 2,
    })

    const persisted = readTeamRuntimeState(testDir, runtime.manifest.team_id)

    expect(runtime.manifest.phase).toBe("starting")
    expect(runtime.tasks.map((task) => task.status)).toEqual(["pending", "pending"])
    expect(runtime.workers.map((worker) => worker.id)).toEqual(["leader", "worker-1", "worker-2"])
    expect(getTeamStatePath(testDir, runtime.manifest.team_id)).toContain(runtime.manifest.team_id)
    expect(persisted?.summary.pending_tasks).toBe(2)
    expect(persisted?.monitor.worker_status["worker-1"]).toBe("pending")
  })

  test("#given pending team tasks #when a worker claims and completes one #then claim token, versions, mailbox, and summaries are updated durably", () => {
    const runtime = initializeTeamRuntime({
      directory: testDir,
      leaderSessionId: "session-1",
      planPath,
      planName: "sample-plan",
      workerCount: 1,
      claimLeaseMs: 60_000,
    })

    const claim = claimNextTeamTask(testDir, runtime.manifest.team_id, { workerId: "worker-1" })
    expect(claim.ok).toBe(true)
    expect(claim.task?.status).toBe("in_progress")
    expect(claim.claimToken).toBeString()

    const completed = transitionTeamTask(testDir, runtime.manifest.team_id, {
      taskId: claim.task!.id,
      workerId: "worker-1",
      claimToken: claim.claimToken!,
      fromStatus: "in_progress",
      toStatus: "completed",
      expectedVersion: claim.task!.version,
      result: "done",
    })

    const persisted = readTeamRuntimeState(testDir, runtime.manifest.team_id)

    expect(completed.version).toBe(claim.task!.version + 1)
    expect(completed.result).toBe("done")
    expect(persisted?.summary.completed_tasks).toBe(1)
    expect(persisted?.summary.pending_tasks).toBe(1)
    expect(persisted?.monitor.active_claims[claim.task!.id]).toBeUndefined()
    expect(persisted?.workers.find((worker) => worker.id === "worker-1")?.claimed_task_ids).toEqual([])
  })

  test("#given active work #when graceful shutdown is requested #then it refuses until work is no longer active", () => {
    const runtime = initializeTeamRuntime({
      directory: testDir,
      leaderSessionId: "session-1",
      planPath,
      planName: "sample-plan",
      workerCount: 1,
    })

    const claim = claimNextTeamTask(testDir, runtime.manifest.team_id, { workerId: "worker-1" })
    expect(() => requestTeamShutdown(testDir, runtime.manifest.team_id, { requestedBy: "leader", mode: "graceful" })).toThrow(
      "Cannot gracefully shutdown while tasks are active",
    )

    transitionTeamTask(testDir, runtime.manifest.team_id, {
      taskId: claim.task!.id,
      workerId: "worker-1",
      claimToken: claim.claimToken!,
      fromStatus: "in_progress",
      toStatus: "completed",
      expectedVersion: claim.task!.version,
    })

    const shutdownState = requestTeamShutdown(testDir, runtime.manifest.team_id, { requestedBy: "leader", mode: "abort" })
    expect(shutdownState.governance.shutdown_mode).toBe("abort")
    expect(shutdownState.phase.current).toBe("shutdown")
  })

  test("#given mailbox messages #when one is delivered #then delivery timestamp is stored", () => {
    const runtime = initializeTeamRuntime({
      directory: testDir,
      leaderSessionId: "session-1",
      planPath,
      planName: "sample-plan",
      workerCount: 1,
    })

    const state = readTeamRuntimeState(testDir, runtime.manifest.team_id)!
    state.mailbox.push({
      message_id: "msg-1",
      from_worker: "leader",
      to_worker: "worker-1",
      body: "do work",
      created_at: "2026-03-12T00:00:00.000Z",
    })
    writeFileSync(join(getTeamStatePath(testDir, runtime.manifest.team_id), "mailbox.json"), `${JSON.stringify(state.mailbox, null, 2)}\n`)

    const delivered = markTeamMailboxMessageDelivered(testDir, runtime.manifest.team_id, "msg-1", "2026-03-12T00:05:00.000Z")
    expect(delivered.delivered_at).toBe("2026-03-12T00:05:00.000Z")
    expect(readTeamRuntimeState(testDir, runtime.manifest.team_id)?.mailbox[0]?.delivered_at).toBe("2026-03-12T00:05:00.000Z")
  })
})
