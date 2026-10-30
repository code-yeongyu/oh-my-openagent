import { afterEach, expect, test } from "bun:test"
import { loadOmoConfig } from "@oh-my-opencode/omo-config-core"
import { createTaskLifecycle } from "@oh-my-opencode/senpi-task"
import { hostLifecycleDeps, hostSession, hostSessionRecordInput } from "../../../../senpi-task/src/lifecycle/__fixtures__/host-session-fakes"
import { cleanupProjects, seedRecord, tempStore } from "../../../../senpi-task/src/lifecycle/__fixtures__/lifecycle-fakes"
import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { composeTaskEngine } from "./engine"
import { wireEventBridge } from "./event-bridge"
import { wireDagLifecycle } from "./index"
import { createSessionTransitionBridge } from "./session-transition-bridge"

afterEach(cleanupProjects)

test("session admission and RPC attachment finish while a host never answers", async () => {
  const store = tempStore()
  seedRecord(store, {
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
  const pi = new FakeExtensionAPI()
  pi.rpc = { emit: (name, data) => { pi.rpcEvents.push({ name, data }) } }
  const cwd = store.stateDir
  const base = composeTaskEngine({ pi, cwd, omoConfig: loadOmoConfig({ cwd }).config, sharedParentTools: () => [] })
  base.lifecycle.dispose?.()
  const finished = Promise.withResolvers<void>()
  const engine = {
    ...base,
    lifecycle: {
      ...lifecycle,
      reconcileOnSessionStart: (id?: string, signal?: AbortSignal) => lifecycle.reconcileOnSessionStart(id, signal).finally(finished.resolve),
    },
  }
  wireEventBridge(pi, {
    logger: { info() {}, warn() {}, error() {} }, config: { getFlag: () => false }, getCapturedTools: () => [],
  }, engine, { scheduleSync() {}, syncNow() {}, observeRecord() {}, dispose() {} },
  createSessionTransitionBridge({ runtime: engine.runtime, notifier: engine.notifier }), {
    reconcileTeamMailbox: async () => {},
    leadPollers: { tick: async () => {}, shutdown() {} },
    resumptionChannels: { emitSessionStart: async () => {}, emitShutdown: async () => {} },
  })
  // RPC attachment is observable through the real task bridge; admission itself must settle
  // before the probe is released, with the test deadline only serving as a deadlock watchdog.
  const start = pi.dispatch("session_start", {}, { sessionManager: { getSessionId: () => "parent-1" } })
  try {
    await entered.promise
    expect(await Promise.race([
      start.then(() => "admitted"),
      new Promise<string>(resolve => setImmediate(() => resolve("blocked"))),
    ])).toBe("admitted")
    expect(pi.rpcEvents.some(event => event.name === "omo.task.updated")).toBe(true)
  } finally {
    lifecycle.dispose?.()
    probe.resolve(false)
    await start
    await finished.promise
  }
})

// #11335 review: DAG recovery and workpool reconciliation rely on session-start task reconciliation
// having finished (recovery.ts: "a revivable child already carries a handle here"), so both wait
// for that ONE reconcile, while admission itself still does not.
test("DAG attach waits for the session-start reconcile without holding admission", async () => {
  const pi = new FakeExtensionAPI()
  const gate = Promise.withResolvers<boolean>()
  const attached: unknown[] = []
  wireDagLifecycle(
    pi,
    {
      attach: async (event) => { attached.push(event) },
      detach() {},
      pauseForShutdown: async () => {},
      dispose() {},
    },
    () => ({ afterSessionStartReconcile: () => gate.promise }),
  )
  await pi.dispatch("session_start", { type: "session_start" }, {})
  expect(attached).toHaveLength(0)
  gate.resolve(true)
  await gate.promise
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(attached).toHaveLength(1)
})

test("workpool attach waits for the session-start reconcile", async () => {
  const store = tempStore()
  seedRecord(store, {
    ...hostSessionRecordInput("st_10056002", hostSession("st_10056002")),
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
  const pi = new FakeExtensionAPI()
  pi.rpc = { emit: (name, data) => { pi.rpcEvents.push({ name, data }) } }
  const cwd = store.stateDir
  const base = composeTaskEngine({ pi, cwd, omoConfig: loadOmoConfig({ cwd }).config, sharedParentTools: () => [] })
  base.lifecycle.dispose?.()
  const finished = Promise.withResolvers<void>()
  const workpoolAttaches: string[] = []
  // The manager and its workpools are class instances with private state: record the attach on
  // the real object instead of copying it.
  const workpools = base.manager.workpools
  if (workpools === undefined) throw new Error("the task engine has no workpools")
  Object.defineProperty(workpools, "attach", {
    value: (input: { readonly sessionId: string }) => { workpoolAttaches.push(input.sessionId) },
  })
  const engine = {
    ...base,
    lifecycle: {
      ...lifecycle,
      reconcileOnSessionStart: (id?: string, signal?: AbortSignal) => lifecycle.reconcileOnSessionStart(id, signal).finally(finished.resolve),
    },
  }
  const bridge = wireEventBridge(pi, {
    logger: { info() {}, warn() {}, error() {} }, config: { getFlag: () => false }, getCapturedTools: () => [],
  }, engine, { scheduleSync() {}, syncNow() {}, observeRecord() {}, dispose() {} },
  createSessionTransitionBridge({ runtime: engine.runtime, notifier: engine.notifier }), {
    reconcileTeamMailbox: async () => {},
    leadPollers: { tick: async () => {}, shutdown() {} },
    resumptionChannels: { emitSessionStart: async () => {}, emitShutdown: async () => {} },
  })
  const start = pi.dispatch("session_start", {}, { sessionManager: { getSessionId: () => "parent-2" } })
  try {
    await entered.promise
    await start
    expect(workpoolAttaches).toEqual([])
  } finally {
    lifecycle.dispose?.()
    probe.resolve(false)
    await finished.promise
  }
  expect(await bridge.afterSessionStartReconcile()).toBe(true)
  expect(workpoolAttaches).toEqual(["parent-2"])
})

test("a session start whose pause restore throws still settles the reconcile gate (#11335 delta review)", async () => {
  const store = tempStore()
  const pi = new FakeExtensionAPI()
  pi.rpc = { emit: (name, data) => { pi.rpcEvents.push({ name, data }) } }
  const cwd = store.stateDir
  const engine = composeTaskEngine({ pi, cwd, omoConfig: loadOmoConfig({ cwd }).config, sharedParentTools: () => [] })
  try {
    const bridge = wireEventBridge(pi, {
      logger: { info() {}, warn() {}, error() {} }, config: { getFlag: () => false }, getCapturedTools: () => [],
    }, engine, { scheduleSync() {}, syncNow() {}, observeRecord() {}, dispose() {} },
    createSessionTransitionBridge({ runtime: engine.runtime, notifier: engine.notifier }), {
      reconcileTeamMailbox: async () => {},
      leadPollers: { tick: async () => {}, shutdown() {} },
      resumptionChannels: { emitSessionStart: async () => {}, emitShutdown: async () => {} },
      runPause: {
        restore: async () => { throw new Error("invalid pause registry") },
        reconciled: async () => {},
        changed: async () => {},
      } as unknown as NonNullable<Parameters<typeof wireEventBridge>[5]["runPause"]>,
    })
    const start = pi.dispatch("session_start", {}, { sessionManager: { getSessionId: () => "parent-3" } })
    await start.catch(() => undefined)
    const settled = await Promise.race([
      bridge.afterSessionStartReconcile().then(() => "settled"),
      new Promise<string>((resolve) => setImmediate(() => resolve("pending"))),
    ])
    expect(settled).toBe("settled")
  } finally {
    engine.lifecycle.dispose?.()
  }
})
