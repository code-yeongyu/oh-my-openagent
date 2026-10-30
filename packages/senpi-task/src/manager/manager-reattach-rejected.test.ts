import { afterEach, describe, expect, test } from "bun:test"

import { seedRecord } from "../lifecycle/__fixtures__/lifecycle-fakes"
import { createTaskRecordStore } from "../store"
import type { ManagedChildHandle } from "./child-handle"
import { cleanupProjects, makeHandle, tempProject } from "./__fixtures__/manager-fakes"
import { reattachManagedTask } from "./manager-reattach"

// A revived daemon child reattaches to the task's one daemon session. When the reattach is rejected
// because another revival owns the task now, that owner may be using the session: it must stay open.

afterEach(cleanupProjects)

const HOST = 11_001

function rejectedReattach(kind: "host-session" | "rpc", rejection: "superseded" | "not_owned" | "attached") {
  const store = createTaskRecordStore({ project_dir: tempProject() })
  const taskId = "st_0bad0001"
  seedRecord(store, { task_id: taskId, status: "interrupted", residency_state: "resident", execution_mode: "process", host_pid: HOST })
  const launched = store.mutate(taskId, (record) => ({ ...record, residency_claim: "launching-claim" }))
  if (launched === null) throw new Error("expected the seeded record")
  if (rejection === "superseded") store.mutate(taskId, (record) => ({ ...record, residency_claim: "newer-claim" }))
  if (rejection === "not_owned") store.mutate(taskId, (record) => ({ ...record, host_pid: 22_002 }))
  const calls: string[] = []
  const base = makeHandle(taskId).handle
  const handle: ManagedChildHandle = {
    ...base,
    kind,
    terminate: async () => {
      calls.push("terminate")
    },
    dispose: async () => {
      calls.push("dispose")
    },
  }
  const reattach = () =>
    reattachManagedTask({
      record: launched,
      handle,
      store,
      hostPid: HOST,
      now: () => 0,
      isAttached: () => rejection === "attached",
      attachLive: () => () => undefined,
      detachLive: () => undefined,
      destroyAttached: async () => undefined,
      armOutcome: () => undefined,
    })
  return { reattach, calls }
}

describe("a reattach rejected because another owner holds the task", () => {
  for (const rejection of ["superseded", "not_owned", "attached"] as const) {
    test(`#given a revived daemon session rejected as ${rejection} #when the handle is let go #then it only detaches and the session stays open`, async () => {
      // given
      const f = rejectedReattach("host-session", rejection)

      // when
      const result = await f.reattach()

      // then
      expect(result.ok).toBe(false)
      expect(f.calls).toEqual(["dispose"])
    })
  }

  test("#given a revived process child rejected as superseded #when the handle is let go #then the process spawned for it is ended", async () => {
    // given
    const f = rejectedReattach("rpc", "superseded")

    // when
    const result = await f.reattach()

    // then
    expect(result.ok).toBe(false)
    expect(f.calls).toEqual(["terminate", "dispose"])
  })
})
