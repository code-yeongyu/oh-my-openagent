import { afterEach, describe, expect, test } from "bun:test"

import { deferralOutlookText, notContinuableReason } from "../steering/engine-policy"
import { deferralOutlookFor } from "./deferred-revival-reasons"
import { harness, resume, settled } from "./__fixtures__/deferred-revival-harness"
import { hostSession, hostSessionRecordInput } from "./__fixtures__/host-session-fakes"
import { cleanupProjects, seedRecord } from "./__fixtures__/lifecycle-fakes"

afterEach(cleanupProjects)

describe("deferred revival retries end with their session (omo#9498 review)", () => {
  for (const stop of ["shutdown", "dispose"] as const) {
    test(`a pending retry stops on session ${stop}: the child is neither revived nor marked lost`, async () => {
      const gate = Promise.withResolvers<void>()
      const firstWait = Promise.withResolvers<void>()
      const h = harness({ succeeds: true, gateWait: () => { firstWait.resolve(); return gate.promise } })
      try {
        await h.lifecycle.reconcileOnSessionStart("parent-1")
        await firstWait.promise
        if (stop === "shutdown") await h.lifecycle.suspendOnSessionShutdown({ parentSessionId: "parent-1", reason: "quit" })
        else h.lifecycle.dispose?.()
        gate.resolve()
        await settled()

        expect(h.attempts()).toBe(1)
        const record = h.store.load(h.taskId)
        expect(record?.residency_state).toBe("persisted_only")
        expect(record?.status).toBe("running")
      } finally {
        h.lifecycle.dispose?.()
      }
    }, 10_000)
  }

  test("a session resumed again after shutdown retries its children again", async () => {
    const h = harness({ succeeds: true })
    try {
      await h.lifecycle.suspendOnSessionShutdown({ parentSessionId: "parent-1", reason: "quit" })
      await resume(h)
      await h.revived
      expect(h.store.load(h.taskId)?.residency_state).toBe("resident")
    } finally {
      h.lifecycle.dispose?.()
    }
  }, 10_000)

  test("a second session start while a retry waits does not start a second retry loop for the same child", async () => {
    const gate = Promise.withResolvers<void>()
    const h = harness({ gateWait: () => gate.promise })
    try {
      await h.lifecycle.reconcileOnSessionStart("parent-1")
      await h.lifecycle.reconcileOnSessionStart("parent-1")
      // One loop is parked on its first backoff; a second loop would have parked a second one.
      expect(h.fixture.waits).toEqual([10])
    } finally {
      h.lifecycle.dispose?.()
      gate.resolve()
    }
  }, 10_000)

  // Review round 2 of omo#9714 (MEDIUM-1): shutdown lands while a retry is inside its revival attempt.
  test("a retry whose revival completes after its session shut down leaves the child suspended, not resident", async () => {
    const inRespawn = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const h = harness({
      succeeds: true,
      attachOnReattach: true,
      respawnGate: (attempt) => {
        if (attempt !== 2) return Promise.resolve()
        inRespawn.resolve()
        return release.promise
      },
    })
    try {
      await h.lifecycle.reconcileOnSessionStart("parent-1")
      await inRespawn.promise
      await h.lifecycle.suspendOnSessionShutdown({ parentSessionId: "parent-1", reason: "quit" })
      // A child the next engine queued for the same session while this attempt was still running.
      seedRecord(h.store, { task_id: "st_94980077", status: "pending", parent_session_id: "parent-1", host_pid: 2222 })
      release.resolve()
      await h.revived
      // Subscribed before the attempt: the late suspend's own record event, not a timing guess.
      expect(await h.suspended).toEqual({ reason: "revived_after_shutdown" })
      await settled()

      expect(h.fixture.registry.get(h.taskId)).toBeUndefined()
      expect(h.store.load(h.taskId)?.residency_state).not.toBe("resident")
      expect(h.store.load(h.taskId)?.status).toBe("running")
      // Only the handle this retry revived is suspended; the queued sibling is left to its own engine.
      expect(h.eventLog.filter((entry) => entry.startsWith("st_94980077:"))).toEqual([])
      expect(h.store.load("st_94980077")?.status).toBe("pending")
    } finally {
      h.lifecycle.dispose?.()
    }
  }, 10_000)

  test("each deferral reason maps to what happens next", () => {
    expect(deferralOutlookFor("model_unavailable", false)).toBe("retried_then_lost")
    expect(deferralOutlookFor("lock_contended", false)).toBe("retried_then_lost")
    expect(deferralOutlookFor("model_unavailable", true)).toBe("retried_not_lost")
    expect(deferralOutlookFor("host_unreachable", true)).toBe("retried_not_lost")
    expect(deferralOutlookFor("capacity", false)).toBe("waits_for_capacity")
    expect(deferralOutlookFor("foreign_live_owner", false)).toBe("may_stay_with_live_owner")
    expect(deferralOutlookFor("reattach_disabled", false)).toBe("not_retried")
    expect(deferralOutlookFor("tools_unavailable", false)).toBe("not_retried")
  })

  test("a daemon-hosted child is told it waits for its host, never that it will be marked lost", () => {
    const daemonHosted = { ...hostSessionRecordInput("st_94980010", hostSession("st_94980010")), task_id: "st_94980010",
      residency_state: "rpc_detached", suspension_reason: "revival_deferred", revival_deferred_reason: "model_unavailable" }
    const text = notContinuableReason(daemonHosted as unknown as Parameters<typeof notContinuableReason>[0])
    expect(text).toContain(deferralOutlookText("retried_not_lost"))
  })
})
