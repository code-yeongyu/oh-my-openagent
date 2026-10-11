import { afterEach, expect, test } from "bun:test"

import { shouldNotifyStatus } from "../completion/routing"
import { handOffToNextRung } from "../lifecycle/fallback-handoff"
import { buildRevived } from "../steering/engine-policy"
import { runTaskOutput } from "../tools/output/output"
import { renderTaskOutputResult } from "../tools/output/renderers"
import { cleanupProjects } from "./__fixtures__/manager-fakes"
import { exitClock, exitedTask } from "./__fixtures__/provisional-exit"

afterEach(cleanupProjects)

test("a provisional write failure cannot strand the live manager's terminal waiter", async () => {
  // Given one storage failure before the provisional record can be committed.
  const clock = exitClock()
  const failedWrite = Promise.withResolvers<void>()
  let refuse = true
  const started = exitedTask((store) => ({
    ...store,
    mutate: (id, mutation) => store.mutate(id, (record) => {
      const next = mutation(record)
      if (refuse && next.provisional_exit !== undefined) {
        refuse = false
        failedWrite.resolve()
        throw new Error("provisional write failed")
      }
      return next
    }),
  }), clock)
  await failedWrite.promise
  // When persistence fails, confirmation is still bounded rather than abandoned.
  expect(clock.size()).toBe(1)
  const f = await started
  try {
    expect(f.store.load(f.taskId)?.status).toBe("running")
    const terminal = f.manager.waitFor(f.taskId)
    clock.advance(2_000)
    // Then the surviving manager settles its waiter, still never before the window.
    expect((await terminal).status).toBe("error")
  } finally {
    f.dispose()
  }
})

test("a later fallback rung or revived run cannot inherit the old provisional exit", async () => {
  // Given a confirmed failure being replaced by a new child/run.
  const f = await exitedTask()
  try {
    const record = f.store.load(f.taskId)
    if (record === null) throw new Error("missing task")
    expect(record.provisional_exit).toBeDefined()
    const timestamp = new Date(f.clock.now() + 2_000).toISOString()
    // When the run-reset builders create a new epoch.
    const next = handOffToNextRung(record, {
      model: { provider: "test", model_id: "next", display: "test/next", source: "category" },
      remaining: [], timestamp,
    })
    // Then neither new run carries evidence about its predecessor's exit.
    expect(next.provisional_exit).toBeUndefined()
    expect(buildRevived(record, timestamp).provisional_exit).toBeUndefined()
  } finally {
    f.dispose()
  }
})

test("an own crash remains running until its manager survives the confirmation window", async () => {
  // Given an unexpected process exit observed by a live manager.
  const f = await exitedTask()
  try {
    expect(f.store.load(f.taskId)?.status).toBe("running")
    expect(f.store.load(f.taskId)?.provisional_exit).toBeDefined()
    expect(f.store.load(f.taskId)?.error_message).toBeUndefined()
    // When the clock reaches, but does not cross, the confirmation deadline.
    f.clock.advance(1_999)
    expect(f.store.load(f.taskId)?.status).toBe("running")
    const terminal = f.manager.waitFor(f.taskId)
    f.clock.advance(1)
    // Then only the surviving manager commits ERROR, with the commit's timestamp.
    const failed = await terminal
    expect(failed.status).toBe("error")
    expect(failed.provisional_exit).toBeUndefined()
    expect(failed.terminal_at).toBe(new Date(f.clock.now()).toISOString())
    expect(f.events()).not.toContain("reconcile_lost")
  } finally {
    f.dispose()
  }
})

test("an early timer callback cannot commit a provisional exit before the window", async () => {
  // Given a timer callback delivered before its promised deadline.
  const f = await exitedTask()
  try {
    expect(f.store.load(f.taskId)?.status).toBe("running")
    // When the scheduler fires early, the remaining duration is scheduled once.
    f.clock.fireEarly()
    expect(f.clock.size()).toBe(1)
    expect(f.store.load(f.taskId)?.status).toBe("running")
    const terminal = f.manager.waitFor(f.taskId)
    f.clock.advance(2_000)
    // Then confirmation, not a callback alone, is what permits ERROR.
    expect((await terminal).status).toBe("error")
  } finally {
    f.dispose()
  }
})

for (const cause of ["child-first tree kill", "own crash then parent death inside the window"]) {
  for (const sessionId of ["parent-1", "new-parent"]) {
    test(`${cause} ends LOST without replaying the crashed child (${sessionId})`, async () => {
      // Given the same provisional exit facts for both causes; their ambiguity is intentional.
      const f = await exitedTask()
      try {
        f.clock.advance(1_000)
        f.manager.forget(f.taskId, { path: "park" })
        // When the owner dies before confirming ERROR, either reconciliation scope sees loss.
        await f.lifecycle.reconcileOnSessionStart(sessionId)
        // Then the conservative contract is LOST even for an independent crash in this window.
        expect(f.store.load(f.taskId)?.status).toBe("lost")
        expect(f.store.load(f.taskId)?.provisional_exit).toBeUndefined()
        expect(f.events()).toContain("reconcile_lost")
        expect(f.respawns()).toBe(0)
        f.clock.advance(2_000)
        expect(f.store.load(f.taskId)?.status).toBe("lost")
      } finally {
        f.dispose()
      }
    })
  }
}

test("a committed own-crash ERROR survives a later parent death", async () => {
  const f = await exitedTask()
  try {
    const terminal = f.manager.waitFor(f.taskId)
    f.clock.advance(2_000)
    const failed = await terminal
    f.manager.forget(f.taskId, { path: "park" })
    // When parent death occurs after ERROR was committed, reconciliation cannot relabel it.
    await f.lifecycle.reconcileOnSessionStart("new-parent")
    expect(f.store.load(f.taskId)?.status).toBe("error")
    expect(f.store.load(f.taskId)?.error_message).toBe(failed.error_message)
    expect(f.events()).not.toContain("reconcile_lost")
  } finally {
    f.dispose()
  }
})

test.each(["parent-1", "new-parent", undefined])("a shutdown-detached provisional exit is LOST instead of replayed on resume (%s)", async (sessionId) => {
  const f = await exitedTask()
  try {
    // Given shutdown detached the dead child's record before the process exited.
    f.store.transition(f.taskId, { type: "detach_rpc", timestamp: new Date(f.clock.now()).toISOString() })
    f.manager.forget(f.taskId, { path: "park" })
    // When the parent resumes, suspension must not erase the unconfirmed exit.
    await f.lifecycle.reconcileOnSessionStart(sessionId)
    expect(f.store.load(f.taskId)?.status).toBe("lost")
    expect(f.events()).toContain("reconcile_lost")
    expect(f.respawns()).toBe(0)
  } finally {
    f.dispose()
  }
})

test("task_output and its renderer expose running, not a provisional error", async () => {
  const f = await exitedTask()
  try {
    // When every task_output mode reads the real record during confirmation.
    for (const mode of ["status", "tail", "full"] as const) {
      const result = await runTaskOutput(
        { manager: f.manager, stateDir: f.store.stateDir, now: f.clock.now },
        { task_id: f.taskId, mode }, "parent-1",
      )
      if (result.details.kind !== "status" && result.details.kind !== "transcript") throw new Error("missing snapshot")
      // Then the machine-readable status and renderer's semantic color both remain non-error.
      expect(result.details.snapshot.status).toBe("running")
      expect(result.details.snapshot.error_message).toBeUndefined()
      const colors: string[] = []
      renderTaskOutputResult(result, { expanded: false, isPartial: false }, {
        fg: (color, text) => { colors.push(color); return text },
      }).render(120)
      expect(colors).not.toContain("error")
      expect(shouldNotifyStatus(result.details.snapshot.status)).toBe(false)
    }
  } finally {
    f.dispose()
  }
})
