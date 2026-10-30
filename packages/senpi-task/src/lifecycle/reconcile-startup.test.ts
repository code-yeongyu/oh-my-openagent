import { afterEach, expect, test } from "bun:test"

import { createTaskLifecycle } from "./create"
import { hostLifecycleDeps, hostSession, hostSessionRecordInput } from "./__fixtures__/host-session-fakes"
import { cleanupProjects, seedRecord, tempStore } from "./__fixtures__/lifecycle-fakes"
import type { ManagedChildHandle } from "../manager/child-handle"

afterEach(cleanupProjects)

for (const change of ["dispose", "new-owner"] as const) {
  test(`host reach completion after ${change} cannot spawn`, async () => {
    const store = tempStore()
    const record = seedRecord(store, {
      ...hostSessionRecordInput("st_10056004", hostSession("st_10056004")),
      residency_state: "rpc_detached", status: "running",
    })
    const entered = Promise.withResolvers<void>()
    const probe = Promise.withResolvers<boolean>()
    const fixture = hostLifecycleDeps({ store, hostPid: 2222 })
    const lifecycle = createTaskLifecycle({
      ...fixture.deps,
      hostSessionProbe: {
        ...fixture.hostSessionProbe,
        daemonAlive: () => { entered.resolve(); return probe.promise },
      },
    })
    const pending = lifecycle.reconcileOnSessionStart("parent-1")
    try {
      await entered.promise
      if (change === "dispose") lifecycle.dispose?.()
      else store.mutate(record.task_id, fresh => ({ ...fresh, residency_claim: "new-owner" }))
      const before = store.load(record.task_id)
      probe.resolve(true)
      await pending
      expect(fixture.respawned).toEqual([])
      if (change === "new-owner") expect(store.load(record.task_id)).toEqual(before)
      else expect(store.load(record.task_id)?.residency_state).toBe("rpc_detached")
    } finally {
      probe.resolve(true)
      await pending
      lifecycle.dispose?.()
    }
  })
}

test("a respawn returning after dispose is suspended without reattachment", async () => {
  const store = tempStore()
  const record = seedRecord(store, {
    ...hostSessionRecordInput("st_10056005", hostSession("st_10056005")),
    residency_state: "rpc_detached", status: "running",
  })
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const calls: string[] = []
  const handle: ManagedChildHandle = {
    task_id: record.task_id, kind: "host-session", pid: undefined, sessionId: "child",
    steer: async () => {}, followUp: async () => {}, abort: async () => { calls.push("abort") },
    dispose: async () => { calls.push("dispose") }, subscribe: () => () => {},
    waitForOutcome: () => new Promise(() => {}), lastAssistantText: () => undefined,
  }
  const fixture = hostLifecycleDeps({
    store, hostPid: 2222,
    respawn: async () => { entered.resolve(); await release.promise; return { ok: true, handle } },
  })
  const lifecycle = createTaskLifecycle({
    ...fixture.deps,
    reattach: async () => { calls.push("reattach"); return { ok: true } },
  })
  const pending = lifecycle.reconcileOnSessionStart("parent-1")
  try {
    await entered.promise
    lifecycle.dispose?.()
    release.resolve()
    await pending
    expect(calls).toEqual(["dispose"])
    expect(store.load(record.task_id)?.residency_state).toBe("rpc_detached")
  } finally {
    lifecycle.dispose?.()
    release.resolve()
    await pending
  }
})

for (const stop of ["dispose", "shutdown"] as const) {
  test(`initial ownership probe completing after ${stop} cannot claim or revive`, async () => {
    const store = tempStore()
    const record = seedRecord(store, {
      ...hostSessionRecordInput("st_10056001", hostSession("st_10056001")),
      status: "running", host_pid: 1111,
    })
    const entered = Promise.withResolvers<void>()
    const probe = Promise.withResolvers<boolean>()
    const fixture = hostLifecycleDeps({ store, hostPid: 2222 })
    const lifecycle = createTaskLifecycle({
      ...fixture.deps,
      hostSessionProbe: {
        ...fixture.hostSessionProbe,
        daemonAlive: () => { entered.resolve(); return probe.promise },
      },
    })
    const pending = lifecycle.reconcileOnSessionStart("parent-1")
    try {
      await entered.promise
      if (stop === "dispose") lifecycle.dispose?.()
      else await lifecycle.suspendOnSessionShutdown({ parentSessionId: "parent-1", reason: "quit" })
      probe.resolve(false)
      await pending
      expect(fixture.respawned).toEqual([])
      expect(store.load(record.task_id)).toEqual(record)
    } finally {
      probe.resolve(false)
      await pending
      lifecycle.dispose?.()
    }
  })
}

test("a hung host does not delay reconciliation on another host", async () => {
  const store = tempStore()
  seedRecord(store, {
    ...hostSessionRecordInput("st_10056001", hostSession("st_10056001", { socket: "/hung.sock" })),
    status: "running", host_pid: 1111,
  })
  seedRecord(store, {
    ...hostSessionRecordInput("st_10056002", hostSession("st_10056002", { socket: "/ready.sock" })),
    status: "running", host_pid: 1111,
  })
  const hung = Promise.withResolvers<boolean>()
  const progressed = Promise.withResolvers<void>()
  const fixture = hostLifecycleDeps({
    store, hostPid: 2222,
    respawn: async () => {
      progressed.resolve()
      return { ok: false, disposition: "retryable", code: "model_unavailable", reason: "test" }
    },
  })
  const lifecycle = createTaskLifecycle({
    ...fixture.deps,
    hostSessionProbe: {
      ...fixture.hostSessionProbe,
      daemonAlive: (identity) => identity.socket === "/hung.sock" ? hung.promise : Promise.resolve(true),
      sessionLive: async () => false,
    },
  })
  const pending = lifecycle.reconcileOnSessionStart("parent-1")
  try {
    expect(await Promise.race([
      progressed.promise.then(() => "progressed"),
      new Promise<string>(resolve => setImmediate(() => resolve("blocked"))),
    ])).toBe("progressed")
    expect(fixture.respawned.map(entry => entry.task_id)).toEqual(["st_10056002"])
  } finally {
    lifecycle.dispose?.()
    hung.resolve(false)
    await pending
  }
})

test("a late probe cannot reclaim a newer same-process ownership claim", async () => {
  const store = tempStore()
  const original = seedRecord(store, {
    ...hostSessionRecordInput("st_10056003", hostSession("st_10056003")),
    status: "running", host_pid: 2222,
  })
  const entered = Promise.withResolvers<void>()
  const probe = Promise.withResolvers<boolean>()
  const fixture = hostLifecycleDeps({ store, hostPid: 2222 })
  const lifecycle = createTaskLifecycle({
    ...fixture.deps,
    hostSessionProbe: {
      ...fixture.hostSessionProbe,
      daemonAlive: () => { entered.resolve(); return probe.promise },
    },
  })
  const pending = lifecycle.reconcileOnSessionStart("parent-1")
  try {
    await entered.promise
    const newer = { ...original, residency_claim: "new-owner" }
    store.replace(newer)
    probe.resolve(false)
    await pending
    expect(store.load(original.task_id)).toEqual(newer)
    expect(fixture.respawned).toEqual([])
  } finally {
    probe.resolve(false)
    await pending
    lifecycle.dispose?.()
  }
})
