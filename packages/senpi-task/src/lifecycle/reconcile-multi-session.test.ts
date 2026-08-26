import { afterEach, describe, expect, test } from "bun:test"

import { createTaskLifecycle } from "./create"
import type { ProcessSignaller } from "./port"
import {
  cleanupProjects,
  FakeRegistry,
  readEvents,
  seedRecord,
  settings,
  tempStore,
} from "./__fixtures__/lifecycle-fakes"

afterEach(cleanupProjects)

type SignalCall = { readonly pid: number; readonly signal: string }

function fakeSignaller(alive: Set<number>, calls: SignalCall[]): ProcessSignaller {
  return {
    isAlive: (pid) => alive.has(pid),
    signal: (pid, signal) => {
      calls.push({ pid, signal })
      alive.delete(pid)
    },
  }
}

const now = () => 5_000_000

// A multi-session host (e.g. the t3/omo desktop shared rpc process) runs one engine per session in
// the SAME OS process, each with its own registry over a shared task store. When a sibling session
// opens, its session_start reconcile must NOT treat a live resident owned by THIS process (another
// session's child) as a crashed-process orphan: same host_pid + absent from this session's registry
// means a live sibling, not a reclaimable in-process corpse.
describe("reconcileOnSessionStart multi-session sibling sweep", () => {
  const thisPid = 1111
  const foreignPid = 4242

  test("#given a running in-process resident owned by THIS process for ANOTHER session #when this session reconciles #then it is deferred as a same-process sibling and never lost", async () => {
    // given a sibling session in the same shared process still owns this in-process child
    const store = tempStore()
    seedRecord(store, {
      task_id: "st_00000030",
      parent_session_id: "session-a",
      status: "running",
      residency_state: "resident",
      execution_mode: "in-process",
      host_pid: thisPid,
    })
    const lifecycle = createTaskLifecycle({
      store,
      registry: new FakeRegistry(),
      config: settings(),
      now,
      signaller: fakeSignaller(new Set([thisPid]), []),
      orphanKillDelayMs: 0,
      hostPid: thisPid,
    })

    // when a DIFFERENT session in the same process reconciles
    const result = await lifecycle.reconcileOnSessionStart("session-b")

    // then the sibling's live child is never falsely declared lost
    const outcome = result.outcomes.find((o) => o.task_id === "st_00000030")
    expect(outcome?.kind).toBe("deferred")
    expect(outcome?.reason).toBe("foreign_live_owner")
    expect(store.load("st_00000030")?.status).toBe("running")
    expect(store.load("st_00000030")?.residency_state).toBe("resident")
    expect(readEvents(store, "st_00000030")).not.toContain("reconcile_lost")
  })

  test("#given a running in-process resident owned by a DEAD foreign process for ANOTHER session #when this session reconciles #then it is still lost (sweep still works)", async () => {
    // given the foreign owner is gone, so the in-process child is genuinely unreachable
    const store = tempStore()
    seedRecord(store, {
      task_id: "st_00000031",
      parent_session_id: "session-a",
      status: "running",
      residency_state: "resident",
      execution_mode: "in-process",
      host_pid: foreignPid,
    })
    const lifecycle = createTaskLifecycle({
      store,
      registry: new FakeRegistry(),
      config: settings(),
      now,
      signaller: fakeSignaller(new Set(), []),
      orphanKillDelayMs: 0,
      hostPid: thisPid,
    })

    // when
    const result = await lifecycle.reconcileOnSessionStart("session-b")

    // then a genuinely dead owner's in-process orphan is still reclaimed
    const outcome = result.outcomes.find((o) => o.task_id === "st_00000031")
    expect(outcome?.kind).toBe("lost")
    expect(store.load("st_00000031")?.status).toBe("lost")
  })
})
