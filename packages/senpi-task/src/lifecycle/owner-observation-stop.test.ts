import { afterEach, describe, expect, test } from "bun:test"

import type { TaskRecord } from "../state"
import { createTaskLifecycle } from "./create"
import { settled } from "./__fixtures__/deferred-revival-harness"
import { hostLifecycleDeps } from "./__fixtures__/host-session-fakes"
import { cleanupProjects, readEvents, seedRecord, tempStore } from "./__fixtures__/lifecycle-fakes"
import { createOwnerProcessView } from "./owner-process"

afterEach(cleanupProjects)

const HOST_PID = 2222
const OWNER_PID = 4444
const CLAIMED_START = "linux-proc-start-ticks:100"
const REUSED_START = "linux-proc-start-ticks:200"

/**
 * Reading a foreign owner's start identity is a wait. This view answers the claimant's own identity until it is held;
 * then the next read parks until released and reports a different process under the pid, so the owner reads as gone.
 */
function heldOwnerView() {
  let held = false
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const view = createOwnerProcessView(async () => {
    if (!held) return CLAIMED_START
    entered.resolve(undefined)
    await release.promise
    return REUSED_START
  })
  return {
    view,
    hold: () => {
      held = true
    },
    entered: entered.promise,
    release: () => release.resolve(undefined),
  }
}

function harness(record: {
  readonly parent: string
  readonly residency: TaskRecord["residency_state"]
  readonly reattach: boolean
}) {
  const store = tempStore()
  const taskId = "st_15138003"
  seedRecord(store, {
    task_id: taskId,
    parent_session_id: record.parent,
    status: "running",
    residency_state: record.residency,
    execution_mode: "process",
    host_pid: OWNER_PID,
    pid: 4445,
    spawn_spec: { version: 1, cwd: "/tmp", prompt: "continue" },
  })
  store.mutate(taskId, (fresh) => ({
    ...fresh,
    host_claim: { pid: OWNER_PID, at: fresh.updated_at, start: CLAIMED_START },
  }))
  const owner = heldOwnerView()
  const retryGate = Promise.withResolvers<undefined>()
  const retryWaiting = Promise.withResolvers<undefined>()
  const fixture = hostLifecycleDeps({
    store,
    hostPid: HOST_PID,
    isAlive: (pid) => pid === OWNER_PID,
    config: { reattach_on_reconcile: record.reattach },
    respawn: async () => ({ ok: false, disposition: "retryable", code: "model_unavailable", reason: "fixture" }),
  })
  const mutations = new Set<() => void>()
  const lifecycle = createTaskLifecycle({
    ...fixture.deps,
    ownerProcesses: owner.view,
    hostRetry: {
      maxDrainAttempts: 10,
      defaultRetryAfterMs: 2_000,
      daemonLossBackoffMs: [],
      deferredRetryBackoffMs: [1],
      wait: () => {
        retryWaiting.resolve(undefined)
        return retryGate.promise
      },
    },
    onStoreMutation: (listener) => {
      mutations.add(listener)
      return () => mutations.delete(listener)
    },
  })
  return {
    store,
    taskId,
    owner,
    fixture,
    lifecycle,
    retryWaiting: retryWaiting.promise,
    releaseRetry: () => retryGate.resolve(undefined),
    notifyMutation: () => {
      for (const listener of mutations) listener()
    },
  }
}

// An owner observation is a wait boundary, like the backoff before it: a stop that lands while the claimant's
// identity is being read must end the retry there, before it reclaims, revives or admits anything.
describe("owner observation is a wait boundary for every recovery path (#12077)", () => {
  test("#given a legacy owner retry for another session's child #when this session shuts down while the owner is observed #then the retry ends without reclaiming the child", async () => {
    // given
    const h = harness({ parent: "old-parent", residency: "resident", reattach: false })
    try {
      const startup = await h.lifecycle.reconcileOnSessionStart("new-parent")
      expect(startup.outcomes[0]).toMatchObject({ kind: "deferred", reason: "foreign_live_owner" })
      await h.retryWaiting
      h.owner.hold()
      h.releaseRetry()
      await h.owner.entered

      // when
      await h.lifecycle.suspendOnSessionShutdown({ parentSessionId: "new-parent", reason: "quit" })
      h.owner.release()
      await settled()

      // then
      expect(h.store.load(h.taskId)).toMatchObject({ status: "running", host_pid: OWNER_PID })
      expect(readEvents(h.store, h.taskId)).not.toContain("reconcile_lost")
    } finally {
      h.lifecycle.dispose?.()
    }
  })

  test("#given a scoped retry deferred to a foreign owner #when its session shuts down while the owner is observed #then the retry ends without reviving the child", async () => {
    // given
    const h = harness({ parent: "parent-1", residency: "rpc_detached", reattach: true })
    try {
      const startup = await h.lifecycle.reconcileOnSessionStart("parent-1")
      expect(startup.outcomes[0]).toMatchObject({ kind: "deferred", reason: "foreign_live_owner" })
      await h.retryWaiting
      h.owner.hold()
      h.releaseRetry()
      await h.owner.entered

      // when
      await h.lifecycle.suspendOnSessionShutdown({ parentSessionId: "parent-1", reason: "quit" })
      h.owner.release()
      await settled()

      // then
      expect(h.fixture.respawned).toEqual([])
      expect(h.store.load(h.taskId)).toMatchObject({ status: "running", residency_state: "rpc_detached" })
    } finally {
      h.lifecycle.dispose?.()
    }
  })

  test("#given live-parent recovery of a suspended child #when its parent session shuts down while the owner is observed #then recovery starts no revival", async () => {
    // given
    const h = harness({ parent: "parent-1", residency: "rpc_detached", reattach: true })
    Object.assign(h.fixture.registry, {
      ownsRecord: (record: { readonly parent_session_id: string }) => record.parent_session_id === "parent-1",
    })
    try {
      h.owner.hold()
      h.notifyMutation()
      await h.owner.entered

      // when
      await h.lifecycle.suspendOnSessionShutdown({ parentSessionId: "parent-1", reason: "quit" })
      h.owner.release()
      await settled()

      // then
      expect(readEvents(h.store, h.taskId)).not.toContain("live_parent_recovery_started")
      expect(h.fixture.respawned).toEqual([])
    } finally {
      h.lifecycle.dispose?.()
    }
  })
})
