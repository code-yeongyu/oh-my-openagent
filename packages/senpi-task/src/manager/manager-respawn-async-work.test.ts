import { appendFileSync } from "node:fs"
import { afterEach, describe, expect, test } from "bun:test"

import { DETACHED_CELL_WAITS, FINAL_RESULT, PROGRESS_NOTE, lifecycleSnapshot } from "../runners/async-work.test-support"
import type { RunnerOutcome } from "../runners/in-process/child-handle"
import { isHostSessionHandle } from "../runners/rpc-host"
import type { FakeHost } from "../runners/rpc-host/__fixtures__/fake-host"
import { childSpec, hostRunnerHarness } from "../runners/rpc-host.test-support"
import { createTaskRecord } from "../state"
import { createTaskRecordStore } from "../store"
import { cleanupProjects, makeManager, tempProject } from "./__fixtures__/manager-fakes"
import { respawnManagedTask } from "./manager-respawn"

const harness = hostRunnerHarness()
afterEach(async () => {
  await harness.release()
  cleanupProjects()
})

function settledYet(outcome: Promise<RunnerOutcome>): Promise<boolean> {
  return Promise.race([outcome.then(() => true), Promise.resolve().then(() => false)])
}

function expectAbandoned(outcome: RunnerOutcome): void {
  expect(outcome.status).toBe("error")
  if (outcome.status !== "error") throw new Error("expected the typed failure")
  expect(outcome.failure.kind).toBe("async_work_pending")
}

/** The durable lifecycle record the engine appends to the session file (customType session-lifecycle). */
function appendLifecycle(sessionPath: string, waits?: unknown): void {
  const data = { ...lifecycleSnapshot(waits), sessionId: "durable-child" }
  appendFileSync(sessionPath, `${JSON.stringify({ type: "custom", customType: "session-lifecycle", data })}\n`)
}

/** A child whose first parent let go after its turn ended on `answer`; the host keeps the session live. */
async function detachedChild(answer: string) {
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
  host.completeTurn(session.routingId, answer)
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
  const respawn = async () => {
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
    return result.handle
  }
  return { project, host, record, session, respawn }
}

function liveSession(host: FakeHost) {
  const live = host.sessions()[0]
  if (live === undefined) throw new Error("the host lost the re-joined session")
  return live
}

/**
 * Review finding 2 on #15137 and its delta HIGH 1 (omo#10487), the recovered-parent paths: a turn held
 * on the child's own async work is never adopted as the result - not by a parent that re-joins the
 * live session, not by one whose host reopened the session from its file, and not through a park that
 * races the outcome's persistence. A genuinely finished child stays adoptable.
 */
describe("respawn of a child whose last turn waited on its own async work (omo#10487)", () => {
  test("#given a live child whose turn ended on a progress note with a cell pending #when the parent respawns its handle #then the note is not the outcome and the wake turn's answer is", async () => {
    // given
    const c = await detachedChild(PROGRESS_NOTE)
    c.host.setLifecycle(c.session.routingId, lifecycleSnapshot(DETACHED_CELL_WAITS))

    // when
    const handle = await c.respawn()
    try {
      // then - the re-joined turn stays held on the live cell
      expect(await settledYet(handle.waitForOutcome())).toBe(false)

      // when - the cell drains (the engine streams its lifecycle record) and its completion wakes the child
      const live = liveSession(c.host)
      c.host.setLifecycle(live.routingId, lifecycleSnapshot())
      c.host.emitRecord(live.routingId, { type: "session_lifecycle", lifecycle: lifecycleSnapshot() })
      c.host.emitRecord(live.routingId, { type: "agent_start" })
      c.host.completeTurn(live.routingId, FINAL_RESULT)

      // then
      expect(await handle.waitForOutcome()).toEqual({ status: "completed", finalResponse: FINAL_RESULT })
    } finally {
      await handle.dispose()
    }
  }, 5_000)

  test("#given a fresh parent #when the host reopened a transcript whose last answer was held on a pending cell #then the turn ends as async_work_pending, never completed", async () => {
    // given - the session file records the cell as still pending after the note
    const c = await detachedChild(PROGRESS_NOTE)
    appendLifecycle(c.session.sessionPath, DETACHED_CELL_WAITS)
    await c.host.restart()

    // when
    const handle = await c.respawn()
    try {
      // then
      expectAbandoned(await handle.waitForOutcome())
    } finally {
      await handle.dispose()
    }
  }, 5_000)

  test("#given a fresh parent #when the host reopened a transcript whose last answer left no work pending #then that answer is adopted", async () => {
    // given
    const c = await detachedChild(FINAL_RESULT)
    appendLifecycle(c.session.sessionPath)
    await c.host.restart()

    // when
    const handle = await c.respawn()
    try {
      // then
      expect(await handle.waitForOutcome()).toEqual({ status: "completed", finalResponse: FINAL_RESULT })
    } finally {
      await handle.dispose()
    }
  }, 5_000)

  test("#given a managed child held on a live cell #when the host parks its session #then the typed failure is persisted before the handle is let go", async () => {
    // given
    const c = await detachedChild(PROGRESS_NOTE)
    c.host.setLifecycle(c.session.routingId, lifecycleSnapshot(DETACHED_CELL_WAITS))
    const { manager, store } = makeManager({ project: c.project })
    store.save(c.record)
    const handle = await c.respawn()
    try {
      expect(await manager.reattach(c.record, handle)).toEqual({ ok: true })
      const terminal = manager.waitFor(c.record.task_id, { signal: AbortSignal.timeout(4_000) })

      // when
      c.host.evict(c.session.sessionPath)

      // then
      const settled = await terminal
      expect(settled.status).toBe("error")
      expect(settled.failure_kind).toBe("async_work_pending")
      // and the park still lands, after that terminal write
      expect(store.load(c.record.task_id)?.status).toBe("error")
      expect(store.load(c.record.task_id)?.residency_state).toBe("rpc_detached")
    } finally {
      await handle.dispose()
    }
  }, 5_000)
})
