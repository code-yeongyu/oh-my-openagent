import { afterEach, describe, expect, test } from "bun:test"

import type { HostSessionIdentity } from "../state"
import type { TaskRecordStore } from "../store"
import { createSteeringEngine } from "../steering/engine"
import type { SteeringPort } from "../steering/types"
import { resolveContext } from "./context"
import { createTaskLifecycle } from "./create"
import { finishPendingCancel } from "./pending-cancel"
import type { LifecycleDeps } from "./port"
import { hostLifecycleDeps, hostSession, hostSessionRecordInput } from "./__fixtures__/host-session-fakes"
import { cleanupProjects, seedRecord, tempStore } from "./__fixtures__/lifecycle-fakes"

afterEach(cleanupProjects)

/**
 * omo#11765, senpi#3114: after a generation handoff the recorded socket is served by the SUCCESSOR,
 * which does not list a child the draining PREDECESSOR still runs. "Not listed on the recorded socket"
 * is therefore not an end: a cancel, a pending-cancel finish and a TTL expunge must each wait for a
 * confirmed end instead of recording the child destroyed while its turn keeps running.
 */

const HOST_PID = 4_242
const OLD = new Date(Date.parse("2026-01-01T00:00:00.000Z")).toISOString()

type EventLog = Array<{ readonly taskId: string; readonly type: string }>

function recordingStore(base: TaskRecordStore, events: EventLog): TaskRecordStore {
  return {
    ...base,
    appendEvent: (taskId, event) => {
      events.push({ taskId, type: event.type })
      return base.appendEvent(taskId, event)
    },
  }
}

function drainingGenerationView(identity: HostSessionIdentity): NonNullable<LifecycleDeps["hostGenerationView"]> {
  return {
    generationPresent: (asked) => Promise.resolve(asked.instance_id === identity.instance_id),
    parkedEntryPresent: () => Promise.resolve(false),
  }
}

function steeringOver(store: TaskRecordStore, deps: LifecycleDeps): SteeringPort {
  const lifecycle = createTaskLifecycle(deps)
  return {
    store,
    liveHandle: () => undefined,
    dequeuePending: () => false,
    reserveForRevive: () => ({ ok: true, commit: () => undefined, release: () => undefined }),
    destruction: {
      destroyResidentTask: (taskId, cause) => lifecycle.destroyResidentTask(taskId, cause),
      ...(lifecycle.hostSessionCancel === undefined ? {} : { hostSessionCancel: lifecycle.hostSessionCancel }),
    },
    runStatsSnapshot: () => undefined,
    now: () => Date.parse("2026-10-29T00:00:00.000Z"),
  }
}

describe("a child still running on a draining generation is never recorded ended", () => {
  test("#given a running host-session child the successor does not list #when task_cancel runs #then it answers cancel_pending and records no cancel and no destroyed", async () => {
    // given
    const events: EventLog = []
    const store = recordingStore(tempStore(), events)
    const identity = hostSession("st_0b000001", { instance_id: "instance-old" })
    const fixture = hostLifecycleDeps({ store, hostPid: HOST_PID })
    seedRecord(store, { ...hostSessionRecordInput("st_0b000001", identity), status: "running", residency_state: "rpc_detached" })
    const engine = createSteeringEngine(steeringOver(store, { ...fixture.deps, hostGenerationView: drainingGenerationView(identity) }))

    // when
    const outcome = await engine.cancelTask("st_0b000001")

    // then
    expect(outcome.kind).toBe("cancel_pending")
    expect(store.load("st_0b000001")?.status).toBe("running")
    expect(store.load("st_0b000001")?.cancel_requested).toBeDefined()
    expect(events.filter((event) => event.type === "destroyed" || event.type === "cancelled")).toEqual([])
    expect(fixture.daemon.closed).toEqual([])
  })

  test("#given a pending cancel whose session the successor does not list #when revival finishes the pending cancel #then the record is not cancelled", async () => {
    // given
    const events: EventLog = []
    const store = recordingStore(tempStore(), events)
    const identity = hostSession("st_0b000002", { instance_id: "instance-old" })
    const fixture = hostLifecycleDeps({ store, hostPid: HOST_PID })
    const seeded = seedRecord(store, { ...hostSessionRecordInput("st_0b000002", identity), status: "running", residency_state: "rpc_detached" })
    const record = store.mutate("st_0b000002", (fresh) => ({ ...fresh, cancel_requested: { requested_at: OLD } })) ?? seeded
    const context = resolveContext({ ...fixture.deps, hostGenerationView: drainingGenerationView(identity) })

    // when
    const outcome = await finishPendingCancel(context, record)

    // then
    expect(outcome).toBeUndefined()
    expect(store.load("st_0b000002")?.status).toBe("running")
    expect(events.filter((event) => event.type === "destroyed" || event.type === "cancelled")).toEqual([])
  })

  test("#given an expired host-session record whose session a draining generation still holds #when TTL sweeps #then the record is retained", async () => {
    // given
    const store = tempStore()
    const identity = hostSession("st_0b000003", { instance_id: "instance-old" })
    const fixture = hostLifecycleDeps({ store, hostPid: HOST_PID })
    seedRecord(store, {
      ...hostSessionRecordInput("st_0b000003", identity),
      status: "cancelled",
      residency_state: "rpc_detached",
      updated_at: OLD,
    })
    const lifecycle = createTaskLifecycle({ ...fixture.deps, hostGenerationView: drainingGenerationView(identity) })

    // when
    const result = await lifecycle.cleanupExpiredRecords()

    // then
    expect(result.deleted).toEqual([])
    expect(store.load("st_0b000003")).not.toBeNull()
  })
})
