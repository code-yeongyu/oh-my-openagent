import { afterEach, describe, expect, test } from "bun:test"

import { createTaskLifecycle } from "./create"
import { cancelHarness, eventsOf } from "./__fixtures__/host-session-cancel-harness"
import { hostLifecycleDeps, hostSession, hostSessionHandle, hostSessionRecordInput } from "./__fixtures__/host-session-fakes"
import { cleanupProjects, seedRecord, tempStore, type CallLog } from "./__fixtures__/lifecycle-fakes"

afterEach(cleanupProjects)

// Contract (omo#11765): a no-handle host-session cancel is recorded cancelled and destroyed only behind
// exactly one host_session_closed that names how the end was confirmed, and the destroy that follows a
// confirmation reuses it instead of probing the daemon again.

describe("endHostSessionChild confirms an end once and the cancel reuses it", () => {
  test("#given the named generation is gone, nothing parked and the successor lists nothing twice #when task_cancel runs #then one proof pass ends it as generation_exited", async () => {
    // given
    const harness = cancelHarness({ taskId: "st_0c000001" })
    harness.view.present = false

    // when
    const outcome = await harness.engine.cancelTask("st_0c000001")

    // then
    expect(outcome.kind).toBe("cancelled")
    expect(eventsOf(harness, "host_session_closed").map((event) => (event.payload as { via: string }).via)).toEqual(["generation_exited"])
    expect(eventsOf(harness, "destroyed")).toHaveLength(1)
    expect(harness.fixture.daemon.listCalls).toBe(2)
    expect(harness.view.presentCalls).toBe(1)
    expect(harness.stopSettlements).toEqual(["st_0c000001"])
  })

  test("#given a drain parked the session for the successor #when task_cancel runs #then today's closer runs at once and the end is recorded via close_session", async () => {
    // given
    const harness = cancelHarness({ taskId: "st_0c000002" })
    harness.view.parked = true

    // when
    const outcome = await harness.engine.cancelTask("st_0c000002")

    // then
    expect(outcome.kind).toBe("cancelled")
    expect(harness.fixture.daemon.closed).toEqual([harness.record.host_session?.session_path ?? "missing session path"])
    expect(eventsOf(harness, "host_session_closed").map((event) => (event.payload as { via: string }).via)).toEqual(["close_session"])
    expect(harness.view.presentCalls).toBe(0)
  })

  test("#given a cancel already pending #when task_cancel runs again #then it joins with the generic reason and starts nothing new", async () => {
    // given
    const harness = cancelHarness({ taskId: "st_0c000003" })
    const first = await harness.engine.cancelTask("st_0c000003")
    const probesAfterFirst = harness.view.presentCalls

    // when
    const second = await harness.engine.cancelTask("st_0c000003")

    // then
    expect(first).toMatchObject({ kind: "cancel_pending", reason: "generation_cannot_cancel" })
    expect(second).toMatchObject({ kind: "cancel_pending", reason: "cancel requested, child unreachable" })
    expect(eventsOf(harness, "cancel_requested")).toHaveLength(1)
    expect(harness.stopRequests).toEqual(["st_0c000003"])
    expect(harness.view.presentCalls).toBe(probesAfterFirst)
  })

  test("#given a steering port without the cancel member #when task_cancel runs #then the cancel stays pending and no stop is requested", async () => {
    // given
    const harness = cancelHarness({ taskId: "st_0c000004", withCancelPort: false })

    // when
    const outcome = await harness.engine.cancelTask("st_0c000004")

    // then
    expect(outcome.kind).toBe("cancel_pending")
    expect(harness.store.load("st_0c000004")?.cancel_requested).toBeDefined()
    expect(harness.stopRequests).toEqual([])
    expect(eventsOf(harness, "destroyed")).toEqual([])
  })

  test("#given a confirmed end retained for an earlier run #when a later run of the task on another generation is asked about #then the cached end is not reused and a fresh pass decides", async () => {
    // given
    const harness = cancelHarness({ taskId: "st_0c000006" })
    const port = harness.lifecycle.hostSessionCancel
    if (port === undefined) throw new Error("the lifecycle exposes no host-session cancel")
    harness.view.present = false
    expect(await port.end(harness.record)).toEqual({ kind: "ended", via: "generation_exited" })
    const identity = harness.record.host_session ?? hostSession("st_0c000006")
    const laterRun = {
      ...harness.record,
      host_session: { ...identity, instance_id: "instance-new" },
      notification: { ...harness.record.notification, run_epoch: harness.record.notification.run_epoch + 1 },
    }
    harness.view.present = true

    // when
    const end = await port.end(laterRun)

    // then
    expect(end).toEqual({ kind: "not_ended", reason: "generation_cannot_cancel" })
  })

  test("#given another writer ends the record while the end pass runs #when task_cancel confirms the end #then it answers noop instead of cancelled", async () => {
    // given
    const harness = cancelHarness({ taskId: "st_0c000007" })
    harness.view.present = false
    harness.view.generationPresent = () => {
      harness.store.transition("st_0c000007", { type: "cancel", timestamp: "2026-10-29T00:00:00.000Z" })
      return Promise.resolve(false)
    }

    // when
    const outcome = await harness.engine.cancelTask("st_0c000007")

    // then
    expect(outcome).toMatchObject({ kind: "noop", task_id: "st_0c000007", status: "cancelled" })
    expect(eventsOf(harness, "cancelled")).toEqual([])
    expect(harness.stopSettlements).toEqual(["st_0c000007"])
  })

  for (const [answered, listings] of [[true, 0], [false, 1]] as const) {
    test(`#given a resident child whose host ${answered ? "answered" : "did not answer"} its close #when the destruction port cancels it #then the daemon is listed ${listings} time(s)`, async () => {
      // given
      const store = tempStore()
      const order: CallLog = []
      const fixture = hostLifecycleDeps({ store, hostPid: 4_242 })
      seedRecord(store, { ...hostSessionRecordInput("st_0c000005", hostSession("st_0c000005")), status: "running", residency_state: "resident", host_pid: 4_242 })
      fixture.registry.add({ ...hostSessionHandle("st_0c000005", order), hostEndAnswered: () => answered })
      const lifecycle = createTaskLifecycle(fixture.deps)

      // when
      await lifecycle.destroyResidentTask("st_0c000005", "cancel")

      // then
      expect(fixture.daemon.listCalls).toBe(listings)
      expect(store.load("st_0c000005")?.residency_state).toBe("disposed")
    })
  }
})
