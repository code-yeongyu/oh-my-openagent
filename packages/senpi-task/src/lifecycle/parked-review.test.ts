import { afterEach, expect, spyOn, test } from "bun:test"
import { cleanupProjects as cleanupManagers } from "../manager/__fixtures__/manager-fakes"
import { cleanupProjects } from "./__fixtures__/lifecycle-fakes"
import { bounded, liveParentFixture } from "./__fixtures__/live-parent-fakes"

const fixtures: ReturnType<typeof liveParentFixture>[] = []
function fixture(mode?: Parameters<typeof liveParentFixture>[0]) {
  const f = liveParentFixture(mode)
  fixtures.push(f)
  return f
}
afterEach(() => {
  for (const f of fixtures.splice(0)) f.dispose()
  cleanupProjects()
  cleanupManagers()
})

test("queued steers are cleared and accounted for in the single terminal result", async () => {
  const f = fixture()
  const id = await f.start()
  const attempted = f.wait("live_parent_recovery_attempt")
  f.park(id)
  await attempted
  for (const message of ["first", "second"]) {
    expect((await f.manager.sendToTask({ idOrName: id, message })).kind).toBe("queued")
  }
  f.state.permanentFailure = true
  f.state.failureCode = "host_incompatible"
  const ended = f.wait("suspended_unresumable")
  f.advance(5_000)
  await ended
  const record = f.store.load(id)
  expect(record?.status).toBe("error")
  expect(record?.pending_steering).toBeUndefined()
  expect(f.recordedEvents.find((event) => event.type === "suspended_unresumable")?.payload)
    .toMatchObject({ undelivered_messages: 2 })
  expect(f.recordedEvents.find((event) => event.type === "steer_dropped")?.payload)
    .toMatchObject({ count: 2, reason: "target_gone" })
  expect(f.messages).toHaveLength(1)
  expect(f.messages[0]?.content).toContain(record?.error_message ?? "missing terminal result")
  f.advance(300_000)
  expect(f.messages).toHaveLength(1)
})

test("an attached live handle survives stale expired recovery markers", async () => {
  const f = fixture()
  const id = await f.start()
  const handle = f.manager.getResidentHandle(id)
  f.store.mutate(id, (record) => ({
    ...record, recovery_deadline_at: 0, suspension_reason: "host_draining",
  }))
  await f.lifecycle.reconcileOnSessionStart("parent-1")
  expect(f.store.load(id)?.status).toBe("running")
  expect(f.store.load(id)?.killed).not.toBe(true)
  expect(f.manager.getResidentHandle(id)).toBe(handle)
  expect(f.messages).toHaveLength(0)
})

test("already-attached revival clears every recovery marker", async () => {
  const f = fixture()
  const id = await f.start()
  const original = f.manager.reattach.bind(f.manager)
  const reattach = spyOn(f.manager, "reattach").mockImplementation(async (...args) => {
    await original(...args)
    return { ok: false, kind: "already_attached", reason: "attached concurrently" }
  })
  f.state.revivable = true
  const attempted = f.wait("live_parent_recovery_attempt")
  f.park(id)
  await attempted
  expect(reattach).toHaveBeenCalledTimes(1)
  expect(f.store.load(id)?.residency_state).toBe("resident")
  expect(f.store.load(id)?.recovery_deadline_at).toBeUndefined()
  expect(f.store.load(id)?.suspension_reason).toBeUndefined()
  expect(f.store.load(id)?.revival_deferred_reason).toBeUndefined()
})

for (const restart of [false, true]) {
  test(`an expired ${restart ? "restart" : "wake"} gets one final successful revival attempt`, async () => {
    const f = fixture()
    const id = await f.start()
    const attempted = f.wait("live_parent_recovery_attempt")
    f.park(id)
    await attempted
    if (restart) {
      await f.lifecycle.suspendOnSessionShutdown({ parentSessionId: "parent-1", reason: "quit" })
      f.restart()
    }
    f.state.revivable = true
    if (restart) {
      f.advance(600_000)
      await f.lifecycle.reconcileOnSessionStart("parent-1")
    } else {
      const revived = f.wait("live_parent_recovery_attempt")
      f.advance(600_000)
      await revived
    }
    expect(f.store.load(id)?.residency_state).toBe("resident")
    expect(f.store.load(id)?.status).toBe("running")
    expect(f.store.load(id)?.recovery_deadline_at).toBeUndefined()
    expect(f.messages).toHaveLength(0)
  })
}

test("a final expired attempt is still bounded when its respawn never settles", async () => {
  const f = fixture()
  const id = await f.start()
  const attempted = f.wait("live_parent_recovery_attempt")
  f.park(id)
  await attempted
  const gate = f.holdRevival()
  f.advance(600_000)
  await gate.started
  const ended = f.wait("suspended_unresumable")
  f.advance(5_000)
  await ended
  const settled = f.wait("live_parent_recovery_attempt")
  gate.resolve()
  await settled
  expect(f.store.load(id)?.status).toBe("error")
  expect(f.messages).toHaveLength(1)
})

test("recoverable daemon refusal detaches without aborting or closing its session", async () => {
  const f = fixture("host-session")
  const id = await f.start()
  const handle = f.manager.getResidentHandle(id)
  if (handle === undefined) throw new Error("fixture has no child")
  const abort = spyOn(handle, "abort")
  const dispose = spyOn(handle, "dispose")
  let terminated = 0
  const getResident = f.registry.get.bind(f.registry)
  spyOn(f.registry, "get").mockImplementation((taskId) => {
    const resident = getResident(taskId)
    return resident === undefined ? undefined : { ...resident, terminate: async () => { terminated += 1 } }
  })
  f.store.mutate(id, (record) => ({ ...record, residency_state: "rpc_detached" }))
  await f.lifecycle.destroyResidentTask(id, "recovery_detach")
  expect(abort).not.toHaveBeenCalled()
  expect(dispose).toHaveBeenCalledTimes(1)
  expect(terminated).toBe(0)
  expect(f.state.closes).toBe(0)
  expect(f.manager.getResidentHandle(id)).toBeUndefined()
  expect(f.store.load(id)?.status).toBe("running")
  expect(f.store.load(id)?.residency_state).toBe("rpc_detached")
})

test("restart reconciliation returns while its expired final revival is held", async () => {
  const f = fixture()
  const id = await f.start()
  const attempted = f.wait("live_parent_recovery_attempt")
  f.park(id)
  await attempted
  await f.lifecycle.suspendOnSessionShutdown({ parentSessionId: "parent-1", reason: "quit" })
  f.restart()
  f.advance(600_000)
  f.state.revivable = true
  const before = f.state.respawns
  const gate = f.holdRevival()
  const reconciled = f.lifecycle.reconcileOnSessionStart("parent-1")
  try {
    await gate.started
    await bounded(reconciled)
    expect(f.state.respawns).toBe(before + 1)
    const ended = f.wait("suspended_unresumable")
    f.advance(5_000)
    await ended
    expect(f.store.load(id)?.status).toBe("error")
    expect(f.messages).toHaveLength(1)
  } finally {
    const settled = f.wait("live_parent_recovery_attempt")
    gate.resolve()
    await settled
    await reconciled
  }
  expect(f.store.load(id)?.status).toBe("error")
  expect(f.manager.getResidentHandle(id)).toBeUndefined()
  expect(f.messages).toHaveLength(1)
})

test("recovery detach forgets a handle even when its disposal rejects", async () => {
  const f = fixture("host-session")
  const id = await f.start()
  const handle = f.manager.getResidentHandle(id)
  if (handle === undefined) throw new Error("fixture has no child")
  const failure = new Error("detach rejected")
  spyOn(handle, "dispose").mockRejectedValueOnce(failure)
  f.store.mutate(id, (record) => ({ ...record, residency_state: "rpc_detached" }))
  await expect(f.lifecycle.destroyResidentTask(id, "recovery_detach")).rejects.toBe(failure)
  expect(f.manager.getResidentHandle(id)).toBeUndefined()
  expect(f.store.load(id)?.status).toBe("running")
  expect(f.store.load(id)?.residency_state).toBe("rpc_detached")
  expect(f.state.closes).toBe(0)
})

test("explicit end reports a forgotten target's dropped queue to its parent", async () => {
  const f = fixture()
  const id = await f.start()
  f.store.mutate(id, record => ({ ...record, pending_steering: [
    { id: "forgotten-1", message: "Q1", deliver_as: "steer" },
    { id: "forgotten-2", message: "Q2", deliver_as: "steer" },
  ] }))
  const notified = Promise.withResolvers<void>()
  const push = f.messages.push.bind(f.messages)
  const notification = spyOn(f.messages, "push").mockImplementation((...messages) => {
    const length = push(...messages)
    notified.resolve()
    return length
  })
  try {
    f.manager.forget(id, { path: "end" })
    await bounded(notified.promise)
    const record = f.store.load(id)
    expect(record?.status).toBe("lost")
    expect(record?.pending_steering).toBeUndefined()
    expect(f.messages).toHaveLength(1)
    expect(f.messages[0]?.content).toContain(record?.error_message ?? "missing drop notice")
    expect(f.recordedEvents.filter(event => event.type === "steer_dropped").map(event => event.payload))
      .toEqual([{ count: 2, reason: "task_forgotten" }])
  } finally {
    notification.mockRestore()
  }
})
