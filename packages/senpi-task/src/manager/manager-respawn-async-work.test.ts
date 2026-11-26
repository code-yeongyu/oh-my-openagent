import { afterEach, describe, expect, test } from "bun:test"

import { DETACHED_CELL_WAITS, FINAL_RESULT, PROGRESS_NOTE, lifecycleSnapshot } from "../runners/async-work.test-support"
import type { RunnerOutcome } from "../runners/in-process/child-handle"
import { isHostSessionHandle } from "../runners/rpc-host"
import { childSpec, hostRunnerHarness } from "../runners/rpc-host.test-support"
import { createTaskRecord } from "../state"
import { createTaskRecordStore } from "../store"
import { cleanupProjects, tempProject } from "./__fixtures__/manager-fakes"
import { respawnManagedTask } from "./manager-respawn"

const harness = hostRunnerHarness()
afterEach(async () => {
  await harness.release()
  cleanupProjects()
})

function settledYet(outcome: Promise<RunnerOutcome>): Promise<boolean> {
  return Promise.race([outcome.then(() => true), Promise.resolve().then(() => false)])
}

/**
 * Review finding 2 on #15137 (omo#10487), the recovered-parent path: a parent that restarts and
 * re-joins a live child whose last turn ended on a progress note while its detached cell still runs
 * must keep that turn held, so a recovered DAG never releases dependents on the note.
 */
describe("respawn re-joins a child whose detached work is still running (omo#10487)", () => {
  test("#given a live child whose turn ended on a progress note with a cell pending #when the parent respawns its handle #then the note is not the outcome and the wake turn's answer is", async () => {
    // given
    const project = tempProject()
    const host = await harness.fakeHost({ transcripts: true })
    const runner = harness.runnerOver(host)
    const initial = createTaskRecord(
      {
        parent_session_id: "parent",
        root_session_id: "parent",
        depth: 1,
        execution_mode: "process",
        model: "anthropic/claude-sonnet-4-5",
        notify_on_terminal: false,
      },
      0,
    )
    const inputStore = createTaskRecordStore({ project_dir: project, task: { state_dir: project } })
    inputStore.save({ ...initial, status: "running", runner_kind: "host-session" })
    const spec = childSpec({ state_dir: project, task_id: initial.task_id, cwd: project, taskStoreDir: project })
    const first = await runner.start(spec)
    if (!isHostSessionHandle(first)) throw new Error("expected a host handle")
    const session = first.hostSession
    const detached = host.waitForConnections(0)
    await first.dispose()
    await detached
    host.completeTurn(session.routingId, PROGRESS_NOTE)
    host.setLifecycle(session.routingId, lifecycleSnapshot(DETACHED_CELL_WAITS))
    const record = {
      ...initial,
      status: "running" as const,
      host_pid: process.pid,
      runner_kind: "host-session" as const,
      spawn_spec: { version: 1 as const, cwd: project, prompt: spec.prompt },
      host_session: {
        socket: host.socketPath,
        routing_id: session.routingId,
        session_path: session.sessionPath,
        instance_id: session.instanceId,
      },
    }

    // when
    const result = await respawnManagedTask({
      beforeLaunch: () => undefined,
      record,
      sessionPath: session.sessionPath,
      stateDir: project,
      runners: {
        "in-process": { start: () => Promise.reject(new Error("unused")) },
        process: { start: () => Promise.reject(new Error("unused")) },
      },
      rpcRunner: runner,
    })
    if (!result.ok) throw new Error(result.reason)
    try {
      // then - the re-joined turn stays held on the live cell
      expect(await settledYet(result.handle.waitForOutcome())).toBe(false)

      // when - the cell drains (the engine streams its lifecycle record) and its completion wakes the child
      const live = host.sessions()[0]
      if (live === undefined) throw new Error("the host lost the re-joined session")
      host.setLifecycle(live.routingId, lifecycleSnapshot())
      host.emitRecord(live.routingId, { type: "session_lifecycle", lifecycle: lifecycleSnapshot() })
      host.emitRecord(live.routingId, { type: "agent_start" })
      host.completeTurn(live.routingId, FINAL_RESULT)

      // then
      expect(await result.handle.waitForOutcome()).toEqual({ status: "completed", finalResponse: FINAL_RESULT })
    } finally {
      await result.handle.dispose()
    }
  }, 5_000)
})
