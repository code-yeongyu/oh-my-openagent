import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import { makeHandle } from "../manager/__fixtures__/manager-fakes"
import { resolveChildSessionDir } from "../runners/rpc/spawn"
import { createTaskRecordStore } from "../store"
import { createTaskLifecycle } from "./create"
import { cleanupProjects, FakeRegistry, readEvents, seedRecord, settings, tempStore } from "./__fixtures__/lifecycle-fakes"

const taskId = "st_00000031"
const startedAt = "2026-09-08T01:00:00.000Z"
const now = () => Date.parse("2026-09-08T01:00:01.000Z")

afterEach(cleanupProjects)

describe("legacy reconciliation current-record loss", () => {
  test.each(["respawn", "reattach"] as const)("#given %s persists launch and notification facts before failing #when reconciled #then loss preserves all current facts", async (failureAt) => {
    // given
    const store = tempStore()
    seedRecord(store, { task_id: taskId, status: "pending", execution_mode: "process", pid: 9001 })
    const sessionDir = resolveChildSessionDir(join(store.stateDir, "children", taskId), taskId)
    mkdirSync(sessionDir, { recursive: true })
    writeFileSync(join(sessionDir, "session.jsonl"), "{}\n")
    const persistFacts = () => store.mutate(taskId, (fresh) => ({
      ...fresh,
      started_at: startedAt,
      child_session_id: "post-launch-session",
      notification: { ...fresh.notification, run_epoch: 7, notified_epoch: 6 },
    }))
    const lifecycle = createTaskLifecycle({
      store, registry: new FakeRegistry(), config: settings(), now, hostPid: 101,
      signaller: { isAlive: () => false, signal: () => { throw new Error("unexpected signal") } },
      respawn: async () => {
        if (failureAt !== "respawn") return { ok: true, handle: makeHandle(taskId).handle }
        persistFacts()
        return { ok: false, disposition: "retryable", code: "respawn_failed", reason: "injected post-launch failure" }
      },
      reattach: async () => {
        persistFacts()
        return { ok: false, kind: "failed", reason: "injected post-attach failure" }
      },
    })

    // when
    const result = await lifecycle.reconcileOnSessionStart()
    lifecycle.dispose?.()

    // then - reopen rather than trusting a cached record from the writer.
    expect(result.outcomes[0]?.kind).toBe("lost")
    expect(createTaskRecordStore({ project_dir: store.stateDir, task: { state_dir: store.stateDir } }).load(taskId)).toMatchObject({
      status: "lost", residency_state: "disposed", started_at: startedAt,
      child_session_id: "post-launch-session", notification: { run_epoch: 7, notified_epoch: 6 },
    })
    expect(readEvents(store, taskId).filter((type) => type === "reconcile_lost")).toHaveLength(1)
  })

  test.each([true, false])("#given a dead-PID probe persists launch facts and detaches with reattach enabled %s #when legacy loss applies #then it preserves the current facts and residency", async (reattachEnabled) => {
    // given - the liveness port changes the record after the ownership claim was read.
    const store = tempStore()
    seedRecord(store, { task_id: taskId, status: "running", execution_mode: "process", pid: 9001 })
    const lifecycle = createTaskLifecycle({
      store, registry: new FakeRegistry(), config: settings({ reattach_on_reconcile: reattachEnabled }), now, hostPid: 101,
      signaller: {
        isAlive: (pid) => {
          if (pid === 9001) store.mutate(taskId, (fresh) => ({ ...fresh, started_at: startedAt, residency_state: "rpc_detached" }))
          return false
        },
        signal: () => { throw new Error("unexpected signal") },
      },
    })

    // when
    const result = await lifecycle.reconcileOnSessionStart()
    lifecycle.dispose?.()

    // then - loss must not dispose a record that is no longer resident.
    expect(result.outcomes[0]?.kind).toBe("lost")
    expect(store.load(taskId)).toMatchObject({ status: "lost", started_at: startedAt, residency_state: "rpc_detached" })
    expect(readEvents(store, taskId)).not.toContain("destroyed")
  })
})
