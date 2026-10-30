import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"
import { createTaskRecordStore } from "../store"
import { createSteeringEngine } from "./engine"
import type { TaskRecord } from "../state"
import type { ManagedChildHandle } from "../manager/child-handle"
import type { SteeringPort } from "./types"
import { readFileSync } from "node:fs"
import { buildRevived } from "./engine-policy"
import { roots, cleanupRoots, detachedTerminal, fakeHandle } from "./__fixtures__/residency"

afterEach(cleanupRoots)

describe("task_send lazy terminal RPC revival", () => {
  test("#given a revived child that exits before acknowledging followUp #when task_send rejects #then delivery is uncertain and the message is not automatically re-sent", async () => {
    const project = mkdtempSync(join(tmpdir(), "senpi-task-steering-followup-exit-"))
    roots.push(project)
    const store = createTaskRecordStore({ project_dir: project })
    const record = detachedTerminal(store)
    let live = false
    let followUpCalls = 0
    let destroys = 0
    let rollbacks = 0
    let commits = 0
    const handle: ManagedChildHandle = {
      ...fakeHandle(record.task_id, []),
      hasExited: () => true,
      followUp: async () => {
        followUpCalls += 1
        throw new Error("RPC process exited before response")
      },
    }
    const port: SteeringPort = {
      store,
      liveHandle: () => (live ? handle : undefined),
      reserveForRevive: () => ({ ok: true, commit: () => { commits += 1 }, release: () => undefined }),
      reviveDetached: async () => {
        live = true
        store.mutate(record.task_id, (fresh) => ({ ...fresh, residency_state: "resident", host_pid: 6000 }))
        return { ok: true }
      },
      rollbackDetachedRevival: () => {
        rollbacks += 1
        return "rolled_back"
      },
      dequeuePending: () => false,
      destruction: { destroyResidentTask: async () => { destroys += 1 } },
      runStatsSnapshot: () => undefined,
      now: () => Date.parse("2026-09-02T00:00:00.000Z"),
    }
    const engine = createSteeringEngine(port)

    const outcome = await engine.sendToTask({ idOrName: record.task_id, message: "apply once" })

    expect(outcome).toMatchObject({ kind: "delivery_uncertain", task_id: record.task_id, run_epoch: 1 })
    expect(destroys).toBe(0)
    expect(rollbacks).toBe(0)
    expect(commits).toBe(1)
    expect(store.load(record.task_id)).toMatchObject({
      status: "running",
      residency_state: "resident",
      host_pid: 6000,
      notification: { run_epoch: 1 },
    })
    const events = readFileSync(join(store.stateDir, "logs", `${record.task_id}.jsonl`), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { type: string; payload: Record<string, unknown> })
    expect(events).toContainEqual({
      type: "revive_delivery_uncertain",
      payload: {
        run_epoch: 1,
        message_sha256: "ff0cc3cc76308748ee4ec96214d396b920bdb9b0e2c0373bca86a727fc5f65ce",
      },
    })

    // An identical resend against the same unacknowledged run epoch is deduplicated by the durable
    // marker on the record (not by handle liveness), so it reports the same uncertain outcome and
    // never reaches followUp again.
    const repeated = await engine.sendToTask({ idOrName: record.task_id, message: "apply once" })

    expect(repeated).toMatchObject({ kind: "delivery_uncertain", task_id: record.task_id, run_epoch: 1 })
    expect(followUpCalls).toBe(1)
  })

  test("#given a record carrying an unacknowledged-delivery marker #when a new run is built #then building an epoch cannot resolve the prior delivery", () => {
    const project = mkdtempSync(join(tmpdir(), "senpi-task-steering-marker-clear-"))
    roots.push(project)
    const store = createTaskRecordStore({ project_dir: project })
    const record = detachedTerminal(store)
    const marked: TaskRecord = {
      ...record,
      revive_delivery_uncertain: { run_epoch: record.notification.run_epoch, message_sha256: "ab".repeat(32) },
    }

    const revived = buildRevived(marked, "2026-09-02T00:00:00.000Z")

    expect(revived.notification.run_epoch).toBe(record.notification.run_epoch + 1)
    expect(revived.revive_delivery_uncertain).toEqual(marked.revive_delivery_uncertain)
  })

  test("#given a revived child that exits before acknowledging followUp #when a cancel already terminalized that epoch #then no uncertainty marker is written and the cancel is preserved", async () => {
    const project = mkdtempSync(join(tmpdir(), "senpi-task-steering-uncertain-fence-"))
    roots.push(project)
    const store = createTaskRecordStore({ project_dir: project })
    const record = detachedTerminal(store)
    let live = false
    let destroys = 0
    let commits = 0
    let releases = 0
    const handle: ManagedChildHandle = {
      ...fakeHandle(record.task_id, []),
      hasExited: () => true,
      followUp: async () => {
        // The cancel wins the terminal transition on the revived epoch while the RPC is in flight.
        store.mutate(record.task_id, (fresh) => ({ ...fresh, status: "cancelled", error_message: "cancelled by user" }))
        throw new Error("RPC process exited before response")
      },
    }
    const port: SteeringPort = {
      store,
      liveHandle: () => (live ? handle : undefined),
      reserveForRevive: () => ({ ok: true, commit: () => { commits += 1 }, release: () => { releases += 1 } }),
      reviveDetached: async () => {
        live = true
        store.mutate(record.task_id, (fresh) => ({ ...fresh, residency_state: "resident", host_pid: 6000 }))
        return { ok: true }
      },
      rollbackDetachedRevival: () => "not_owner",
      dequeuePending: () => false,
      destruction: { destroyResidentTask: async () => { destroys += 1 } },
      runStatsSnapshot: () => undefined,
      now: () => Date.parse("2026-09-02T00:00:00.000Z"),
    }
    const engine = createSteeringEngine(port)

    const outcome = await engine.sendToTask({ idOrName: record.task_id, message: "apply once" })

    expect(outcome.kind).toBe("not_continuable")
    expect(destroys).toBe(0)
    expect(commits).toBe(0)
    expect(releases).toBe(1)
    const current = store.load(record.task_id)
    expect(current).toMatchObject({ status: "cancelled", error_message: "cancelled by user", notification: { run_epoch: 1 } })
    expect(current?.revive_delivery_uncertain).toBeUndefined()
  })

  test("#given a revived child that exits before acknowledging followUp #when the fenced marker write throws #then the reservation is released exactly once and no marker is written", async () => {
    const project = mkdtempSync(join(tmpdir(), "senpi-task-steering-uncertain-mutate-throws-"))
    roots.push(project)
    const baseStore = createTaskRecordStore({ project_dir: project })
    const record = detachedTerminal(baseStore)
    let live = false
    let destroys = 0
    let commits = 0
    let releases = 0
    let armed = false
    // The fenced uncertainty write hits a record-lock failure (e.g. lock timeout under contention).
    const store = {
      ...baseStore,
      mutate(taskId: string, update: (fresh: TaskRecord) => TaskRecord) {
        if (armed) throw new Error("record lock timed out")
        return baseStore.mutate(taskId, update)
      },
    }
    const handle: ManagedChildHandle = {
      ...fakeHandle(record.task_id, []),
      hasExited: () => true,
      followUp: async () => {
        armed = true
        throw new Error("RPC process exited before response")
      },
    }
    const port: SteeringPort = {
      store,
      liveHandle: () => (live ? handle : undefined),
      reserveForRevive: () => ({ ok: true, commit: () => { commits += 1 }, release: () => { releases += 1 } }),
      reviveDetached: async () => {
        live = true
        baseStore.mutate(record.task_id, (fresh) => ({ ...fresh, residency_state: "resident", host_pid: 6000 }))
        return { ok: true }
      },
      rollbackDetachedRevival: () => "not_owner",
      dequeuePending: () => false,
      destruction: { destroyResidentTask: async () => { destroys += 1 } },
      runStatsSnapshot: () => undefined,
      now: () => Date.parse("2026-09-02T00:00:00.000Z"),
    }
    const engine = createSteeringEngine(port)

    const outcome = await engine.sendToTask({ idOrName: record.task_id, message: "apply once" })

    expect(outcome.kind).toBe("not_continuable")
    expect(commits).toBe(0)
    expect(releases).toBe(1)
    expect(destroys).toBe(0)
    expect(baseStore.load(record.task_id)?.revive_delivery_uncertain).toBeUndefined()
  })
})
