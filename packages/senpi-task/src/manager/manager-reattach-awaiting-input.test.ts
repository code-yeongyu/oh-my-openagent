import { afterEach, describe, expect, test } from "bun:test"

import { seedRecord } from "../lifecycle/__fixtures__/lifecycle-fakes"
import { createTaskRecordStore } from "../store"
import { cleanupProjects, makeHandle, tempProject } from "./__fixtures__/manager-fakes"
import { reattachManagedTask } from "./manager-reattach"

// senpi#3266: a revival that re-joins a session whose last turn ended aborted (or never answered)
// flags the reattached record `awaiting_input`, so task_output and the live row say
// "resumed, waiting for input" instead of sitting on "starting" forever.

afterEach(cleanupProjects)

const HOST = 11_001
const NOW = Date.parse("2026-10-14T00:00:00.000Z")

function fixture(options: { readonly status?: "running" | "completed" } = {}) {
  const store = createTaskRecordStore({ project_dir: tempProject() })
  const taskId = "st_0a326601"
  seedRecord(store, {
    task_id: taskId,
    status: options.status ?? "running",
    residency_state: "resident",
    execution_mode: "process",
    host_pid: HOST,
  })
  const launched = store.mutate(taskId, (record) => ({ ...record, residency_claim: "launching-claim" }))
  if (launched === null) throw new Error("expected the seeded record")
  const base = makeHandle(taskId).handle
  const handle = { ...base, kind: "host-session" as const }
  const reattach = (awaitingInput?: "resumed_turn_aborted" | "resumed_turn_unfinished") =>
    reattachManagedTask({
      record: launched,
      handle,
      store,
      hostPid: HOST,
      now: () => NOW,
      isAttached: () => false,
      attachLive: () => () => undefined,
      detachLive: () => undefined,
      destroyAttached: async () => undefined,
      armOutcome: () => undefined,
      ...(awaitingInput === undefined ? {} : { awaitingInput: { reason: awaitingInput } }),
    })
  return { store, taskId, reattach }
}

describe("a reattach flagged awaiting input (senpi#3266)", () => {
  test("#given a revival that found an aborted turn #when the task reattaches #then the record carries awaiting_input with the reason and timestamp", async () => {
    // given
    const f = fixture()

    // when
    const result = await f.reattach("resumed_turn_aborted")

    // then
    expect(result.ok).toBe(true)
    const stored = f.store.load(f.taskId)
    expect(stored?.status).toBe("running")
    expect(stored?.awaiting_input?.reason).toBe("resumed_turn_aborted")
    expect(typeof stored?.awaiting_input?.since).toBe("string")
  })

  test("#given a revival that found an unfinished turn #when the task reattaches #then the record carries awaiting_input resumed_turn_unfinished", async () => {
    // given
    const f = fixture()

    // when
    const result = await f.reattach("resumed_turn_unfinished")

    // then
    expect(result.ok).toBe(true)
    expect(f.store.load(f.taskId)?.awaiting_input?.reason).toBe("resumed_turn_unfinished")
  })

  test("#given a record still carrying a stale flag #when a plain reattach opens a new run #then the flag is stripped", async () => {
    // given - a previous episode's flag must not leak into a run that re-attached cleanly
    const f = fixture()
    f.store.mutate(f.taskId, (record) => ({
      ...record,
      awaiting_input: { reason: "resumed_turn_aborted", since: "2026-10-13T00:00:00.000Z" },
    }))

    // when
    const result = await f.reattach()

    // then
    expect(result.ok).toBe(true)
    expect(f.store.load(f.taskId)?.awaiting_input).toBeUndefined()
  })

  test("#given a terminal record #when it reattaches with a flag #then the flag is never stamped on a finished result", async () => {
    // given
    const f = fixture({ status: "completed" })

    // when
    const result = await f.reattach("resumed_turn_aborted")

    // then
    expect(result.ok).toBe(true)
    expect(f.store.load(f.taskId)?.awaiting_input).toBeUndefined()
  })
})
