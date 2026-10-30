import { afterEach, expect, test } from "bun:test"
import { cleanupProjects as cleanupManagers } from "../manager/__fixtures__/manager-fakes"
import { cleanupProjects } from "./__fixtures__/lifecycle-fakes"
import { liveParentFixture } from "./__fixtures__/live-parent-fakes"
import { resolveContext } from "./context"
import { startLiveParentRecovery } from "./live-parent-recovery"

const fixtures: ReturnType<typeof liveParentFixture>[] = []
function fixture() {
  const f = liveParentFixture()
  fixtures.push(f)
  return f
}
afterEach(() => {
  for (const f of fixtures.splice(0)) f.dispose()
  cleanupProjects()
  cleanupManagers()
})

test("queued permanent refusal ends before another respawn attempt", async () => {
  const f = fixture()
  const id = await f.start()
  const attempted = f.wait("live_parent_recovery_attempt")
  f.park(id)
  await attempted
  await f.manager.sendToTask({ idOrName: id, message: "Q1" })
  f.store.mutate(id, record => ({ ...record, revival_deferred_reason: "host_incompatible" }))
  const respawns = f.state.respawns
  const ended = f.wait("suspended_unresumable")

  f.advance(5_000)
  await ended

  expect(f.state.respawns).toBe(respawns)
  expect(f.store.load(id)?.status).toBe("error")
  expect(f.messages).toHaveLength(1)
})

test("queued attempt crossing the deadline re-scans on settlement without a timer tick", async () => {
  const f = fixture()
  const id = await f.start()
  f.lifecycle.dispose?.()
  const recovery = startLiveParentRecovery(resolveContext(f.deps), undefined)
  const gate = f.holdRevival()
  f.store.mutate(id, record => ({ ...record, pending_steering: [{ id: "deadline", message: "Q1", deliver_as: "steer" }] }))
  f.park(id)
  recovery.scan()
  await gate.started
  expect(f.store.load(id)?.recovery_deadline_at).toBeDefined()
  const ended = f.wait("suspended_unresumable")

  try {
    f.advance(300_000, false)
    gate.resolve()
    await ended
    expect(f.store.load(id)?.status).toBe("error")
    expect(f.messages).toHaveLength(1)
  } finally {
    recovery.dispose()
    gate.resolve()
  }
})

test("queued final revival still in flight is ended by the deadline tick", async () => {
  const f = fixture()
  const id = await f.start()
  const attempted = f.wait("live_parent_recovery_attempt")
  f.park(id)
  await attempted
  await f.manager.sendToTask({ idOrName: id, message: "Q1" })
  const gate = f.holdRevival()
  f.advance(600_000)
  await gate.started
  try {
    const ended = f.wait("suspended_unresumable")
    f.advance(5_000)
    await ended
    expect(f.store.load(id)?.status).toBe("error")
    expect(f.messages).toHaveLength(1)
  } finally {
    const settled = f.wait("live_parent_recovery_attempt")
    gate.resolve()
    await settled
  }
})
