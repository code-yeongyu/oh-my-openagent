import { afterEach, describe, expect, test } from "bun:test"

import { notContinuableReason } from "../steering/engine-policy"
import { runTaskOutput } from "../tools/output/output"
import { harness, resume } from "./__fixtures__/deferred-revival-harness"
import { cleanupProjects, seedRecord } from "./__fixtures__/lifecycle-fakes"

afterEach(cleanupProjects)

describe("bounded resumed-child revival (omo#9498)", () => {
  test("model_unavailable on session start revives on the first retry without a new session start", async () => {
    const h = harness({ succeeds: true })
    try {
      const result = await resume(h)
      expect(result.outcomes).toContainEqual({ task_id: h.taskId, kind: "deferred", reason: "model_unavailable" })
      await h.revived
      expect(h.attempts()).toBe(2)
      expect(h.fixture.waits).toEqual([10])
      expect(h.store.load(h.taskId)?.residency_state).toBe("resident")
      expect(h.store.load(h.taskId)?.suspension_reason).toBeUndefined()
    } finally {
      h.lifecycle.dispose?.()
    }
  }, 10_000)

  test("model_unavailable exhausted retries mark lost and task_output reports terminal breadcrumbs", async () => {
    const h = harness()
    try {
      await resume(h)
      await h.lost
      const record = h.store.load(h.taskId)
      if (record === null) throw new Error("lost child record disappeared")
      expect(h.attempts()).toBe(4)
      expect(h.fixture.waits).toEqual([10, 20, 40])
      expect(record.status).toBe("lost")
      expect(record.error_message).toContain("model_unavailable")
      expect(record.error_message).toContain("3 retry attempts")
      const output = await runTaskOutput({
        manager: {
          get: (id) => h.store.load(id) ?? undefined,
          list: () => h.store.list().records.map((entry) => ({ record: entry })),
        },
        stateDir: h.store.stateDir,
      }, { task_id: h.taskId }, "parent-1")
      expect(output.content).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: "text", text: expect.stringContaining("[lost]") }),
      ]))
      expect(output.details.kind).toBe("status")
      if (output.details.kind === "status") expect(output.details.snapshot.lost?.session_dir).toBeDefined()
    } finally {
      h.lifecycle.dispose?.()
    }
  }, 10_000)

  test("capacity exhaustion stays suspended and task_send states the recorded capacity deferral", async () => {
    const h = harness({ capacity: true })
    try {
      await resume(h)
      expect(await h.exhausted).toEqual({ reason: "capacity", attempts: 3 })
      const record = h.store.load(h.taskId)
      if (record === null) throw new Error("capacity-deferred child record disappeared")
      expect(record.status).toBe("running")
      expect(record.residency_state).toBe("persisted_only")
      expect(record.suspension_reason).toBe("revival_deferred")
      expect(record.revival_deferred_reason).toBe("capacity")
      expect(notContinuableReason(record)).toContain("capacity")
      expect(h.attempts()).toBe(0)
      expect(h.fixture.waits).toEqual([10, 20, 40])
    } finally {
      h.lifecycle.dispose?.()
    }
  }, 10_000)

  test("a daemon-hosted model deferral exhausts the same retries without ever becoming lost", async () => {
    const h = harness({ host: true })
    try {
      await resume(h)
      expect(await h.exhausted).toEqual({ reason: "model_unavailable", attempts: 3 })
      expect(h.attempts()).toBe(4)
      expect(h.store.load(h.taskId)?.status).toBe("running")
      expect(h.store.load(h.taskId)?.residency_state).toBe("rpc_detached")
      expect(h.store.load(h.taskId)?.error_message).toBeUndefined()
      expect(h.fixture.daemon.closed).toEqual([])
    } finally {
      h.lifecycle.dispose?.()
    }
  }, 10_000)

  for (const reason of ["session_unavailable", "lock_contended", "rollback_failed"] as const) {
    test(`${reason} exhausts retries through the existing lost transition`, async () => {
      const h = harness({
        failure: reason === "session_unavailable" ? reason : undefined,
        lock: reason === "lock_contended",
        rollback: reason === "rollback_failed",
      })
      try {
        await resume(h)
        await h.lost
        expect(h.store.load(h.taskId)?.status).toBe("lost")
        expect(h.store.load(h.taskId)?.error_message).toContain(`${reason}; exhausted 3 retry attempts`)
        expect(h.fixture.waits).toEqual([10, 20, 40])
      } finally {
        h.lifecycle.dispose?.()
      }
    }, 10_000)
  }

  test("a live foreign owner retains its suspended child after the retry budget", async () => {
    const h = harness({ foreign: true })
    try {
      const before = h.store.load(h.taskId)
      expect(before?.host_pid).toBe(4444)
      expect(h.fixture.deps.signaller?.isAlive(4444)).toBe(true)
      await resume(h)
      expect(await h.exhausted).toEqual({ reason: "foreign_live_owner", attempts: 3 })
      expect(h.store.load(h.taskId)).toEqual(before)
      expect(h.attempts()).toBe(0)
      expect(h.fixture.waits).toEqual([10, 20, 40])
    } finally {
      h.lifecycle.dispose?.()
    }
  }, 10_000)

  // Review of omo#9714 (H1): a retry must not outlive the session that scheduled it.
})
