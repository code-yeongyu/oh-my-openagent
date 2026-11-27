// A host killed mid-run leaves its run `running` and its node's child mid-turn. On reopen the
// lifecycle revives the child: the host reports the turn interrupted (the record reads
// `interrupted`), the continuation is delivered, and the continued run reopens the record when it
// starts. DAG recovery runs after that revival. It must never read the child inside the window
// between the `interrupted` mark and the reopen, or it folds a child that is about to run as a
// failed node and the run fails while the child keeps working (#15125).
import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { cleanupProjects } from "../manager/__fixtures__/manager-fakes"
import { reconciliationHarness, stoppedChild } from "../manager/host-reconciliation.test-support"
import { ownedTaskState } from "../store/__fixtures__/owned-task-state"
import { node, owner, pausedRecord, runId } from "./__fixtures__/reattached-run"
import type { DagDefinition } from "./graph"
import { subscribeDagJournal } from "./journal"
import type { DagRunRecordV1 } from "./manager"
import { createDagRecovery } from "./recovery"
import { createDagFileStore, type DagFileStore } from "./store"

const DEAD_HOST_PID = 9001
const cleanupRoots: string[] = []

afterEach(async () => {
  await reconciliationHarness.release()
  cleanupProjects()
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

const definition: DagDefinition = {
  key: "revival-window",
  name: "revival window",
  nodes: [node("slow"), node("next", ["slow"])],
}

type Child = Awaited<ReturnType<typeof stoppedChild>>

async function killedRun(): Promise<{ readonly child: Child; readonly store: DagFileStore }> {
  const child = await stoppedChild({ state: "done", outcome: { kind: "interrupted_by_reopen" } })
  const { parent_session_id: parent, task_id: taskId } = child.record
  child.store.mutate(taskId, (record) => ({ ...record, owner: owner("slow") }))
  const directory = fs.mkdtempSync(join(tmpdir(), "senpi-dag-revival-window-"))
  cleanupRoots.push(directory)
  const store = createDagFileStore(ownedTaskState(directory))
  const { previousLeaseHolderPid: _previous, ...paused } = pausedRecord(definition, {
    slow: { state: "running", taskId, attempt: 1 },
    next: { state: "pending" },
  })
  store.writeCheckpoint(runId, {
    ...paused,
    parentSessionId: parent,
    rootSessionId: parent,
    status: "running",
    leaseHolderPid: DEAD_HOST_PID,
  })
  return { child, store }
}

function recoveryOver(fixture: { readonly child: Child; readonly store: DagFileStore }) {
  return createDagRecovery({
    store: fixture.store,
    taskManager: fixture.child.manager,
    hostPid: process.pid,
    isProcessAlive: () => false,
    isRunHeldInProcess: () => false,
  })
}

function attachedTask(store: DagFileStore, nodeId: string): { readonly taskId: Promise<string>; stop(): void } {
  const attached = Promise.withResolvers<string>()
  const stop = subscribeDagJournal(store, runId, (event) => {
    if (event.type === "dag.node.task-attached" && event.nodeId === nodeId) attached.resolve(event.taskId)
  })
  return { taskId: attached.promise, stop }
}

function continuedSession(child: Child): string {
  const session = child.host.sessions()[0]
  if (session === undefined) throw new Error("missing continued session")
  return session.routingId
}

async function finishRun(
  fixture: { readonly child: Child; readonly store: DagFileStore },
  recovered: Promise<unknown>,
) {
  const next = attachedTask(fixture.store, "next")
  fixture.child.host.completeTurn(continuedSession(fixture.child), "CONTINUATION ANSWER")
  await settleNext(fixture.child, next, recovered)
}

async function settleNext(child: Child, next: ReturnType<typeof attachedTask>, recovered: Promise<unknown>) {
  const settled = await Promise.race([recovered.then(() => undefined), next.taskId])
  next.stop()
  if (settled !== undefined)
    child.inProcess.handles.get(settled)?.settle({ status: "completed", finalResponse: "done next" })
}

function nodeStates(store: DagFileStore): readonly string[] {
  const record = store.readCheckpoint<DagRunRecordV1>(runId)
  return record?.nodes.map((entry) => [entry.id, entry.state, entry.error?.code].filter(Boolean).join(":")) ?? []
}

describe("DAG recovery after a revival that delivers a continuation (#15125)", () => {
  test("#given the continued run has not started yet when the revival returns #when recovery runs after it #then the node follows the continued run instead of failing", async () => {
    // given
    const fixture = await killedRun()
    const { child } = fixture
    const recovery = recoveryOver(fixture)
    // The continued run's start is held: it is released only once the revival is following the
    // continuation (the fix) or once recovery has already settled the run (the defect).
    const following = Promise.withResolvers<void>()
    const handle = child.result.handle
    const waitForOutcome = handle.waitForOutcome.bind(handle)
    handle.waitForOutcome = () => {
      following.resolve()
      return waitForOutcome()
    }

    // when - session start: lifecycle revival first, DAG recovery strictly after it
    const revival = child.manager.reattach(child.record, handle)
    const recovered = revival.then(() => recovery.resumePausedRuns(child.record.parent_session_id))
    await Promise.race([following.promise, recovered.then(() => undefined)])
    child.startContinuation()
    expect(await revival).toEqual({ ok: true })
    await child.resumed
    await finishRun(fixture, recovered)
    const [outcome] = await recovered

    // then
    expect(outcome?.kind).toBe("resumed")
    expect(nodeStates(fixture.store)).toEqual(["slow:completed", "next:completed"])
    expect(child.store.load(child.record.task_id)).toMatchObject({
      status: "completed",
      final_response: "CONTINUATION ANSWER",
      resumed_run_epoch: 1,
    })
  })

  test("#given the continued run already reopened the record #when recovery runs #then the node is reattached and completes", async () => {
    // given
    const fixture = await killedRun()
    const { child } = fixture
    const recovery = recoveryOver(fixture)

    // when - the gate is released first: the continued run starts and reopens before recovery reads
    const revival = child.manager.reattach(child.record, child.result.handle)
    child.startContinuation()
    expect(await revival).toEqual({ ok: true })
    await child.resumed
    const recovered = recovery.resumePausedRuns(child.record.parent_session_id)
    await finishRun(fixture, recovered)
    const [outcome] = await recovered

    // then
    expect(outcome?.kind).toBe("resumed")
    expect(nodeStates(fixture.store)).toEqual(["slow:completed", "next:completed"])
  })

  test("#given the continued run starts and finishes at once #when the revival returns #then recovery folds the finished run's answer", async () => {
    // given
    const fixture = await killedRun()
    const { child } = fixture
    const recovery = recoveryOver(fixture)

    // when
    const revival = child.manager.reattach(child.record, child.result.handle)
    child.startContinuation()
    child.host.completeTurn(continuedSession(child), "CONTINUATION ANSWER")
    expect(await revival).toEqual({ ok: true })
    const next = attachedTask(fixture.store, "next")
    const recovered = recovery.resumePausedRuns(child.record.parent_session_id)
    await settleNext(child, next, recovered)
    const [outcome] = await recovered

    // then
    expect(outcome?.kind).toBe("resumed")
    expect(nodeStates(fixture.store)).toEqual(["slow:completed", "next:completed"])
    expect(child.store.load(child.record.task_id)?.final_response).toBe("CONTINUATION ANSWER")
  })

  test("#given the session ends before the delivered continuation runs #when the revival returns #then the child stays interrupted and its node fails", async () => {
    // given
    const fixture = await killedRun()
    const { child } = fixture
    const recovery = recoveryOver(fixture)

    // when - the host ends the session instead of starting the continued run
    const revival = child.manager.reattach(child.record, child.result.handle)
    child.host.closeSession(continuedSession(child), "client_close")
    expect(await revival).toEqual({ ok: true })
    const [outcome] = await recovery.resumePausedRuns(child.record.parent_session_id)

    // then
    expect(child.events).not.toContain("task_self_resumed")
    expect(child.store.load(child.record.task_id)?.status).toBe("interrupted")
    expect(outcome?.kind).toBe("resumed")
    expect(nodeStates(fixture.store)).toEqual(["slow:failed:task_interrupted", "next:skipped"])
  })
})
