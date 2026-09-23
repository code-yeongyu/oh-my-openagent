import { afterEach, expect, test } from "bun:test"
import { spawn } from "node:child_process"
import { once } from "node:events"

import { loadOmoConfig } from "@oh-my-opencode/omo-config-core"
import { createTaskLifecycle } from "@oh-my-opencode/senpi-task"
import { cleanupProjects, FakeRegistry, seedRecord, settings, tempStore } from "../../../../senpi-task/src/lifecycle/__fixtures__/lifecycle-fakes"
import { terminateRpcChild } from "../../../../senpi-task/src/runners/rpc/terminate"
import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { composeTaskEngine } from "./engine"
import { wireEventBridge } from "./event-bridge"
import { createSessionTransitionBridge } from "./session-transition-bridge"

afterEach(cleanupProjects)

for (const path of ["park", "missing-session", "normal", "missing-session-running"] as const) {
  test(`process resident is suspended after ${path}`, async () => {
    const child = spawn(process.execPath, ["-e", 'process.stdin.resume(); console.log("ready")'], {
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
      windowsHide: true,
    })
    const ready = once(child.stdout!, "data")
    const exited = once(child, "exit")
    const store = tempStore()
    const registry = new FakeRegistry()
    const pi = new FakeExtensionAPI()
    const cwd = store.stateDir
    const base = composeTaskEngine({ pi, cwd, omoConfig: loadOmoConfig({ cwd }).config, sharedParentTools: () => [] })
    base.lifecycle.dispose?.()
    const lifecycle = createTaskLifecycle({
      store, registry, config: settings(),
      now: () => Date.now() + 86_400_000,
    })
    try {
      await ready
      const record = seedRecord(store, {
        task_id: "st_000000a7", parent_session_id: "parent-7",
        execution_mode: "process", status: path === "missing-session-running" ? "running" : "completed",
        host_pid: process.pid, pid: child.pid,
      })
      const sibling = seedRecord(store, {
        task_id: "st_000000b7", parent_session_id: "sibling-7",
        status: "running", host_pid: process.pid,
      })
      registry.add({
        task_id: record.task_id, kind: "rpc", pid: child.pid,
        abort: async () => {},
        terminate: () => terminateRpcChild(child, { sigkillDelayMs: 100 }),
        dispose: async () => {},
      })
      const engine = {
        ...base, lifecycle,
        manager: {
          ...base.manager,
          residentTaskIds: () => registry.entries().map(handle => handle.task_id),
          get: (id: string) => store.load(id) ?? undefined,
        },
      }
      wireEventBridge(pi, {
        logger: { info() {}, warn() {}, error() {} },
        config: { getFlag: () => false },
        getCapturedTools: () => [],
      }, engine, { scheduleSync() {}, syncNow() {}, dispose() {} },
      createSessionTransitionBridge({ runtime: engine.runtime, notifier: engine.notifier }), {
        reconcileTeamMailbox: async () => {},
        leadPollers: { tick: async () => {}, shutdown() {} },
        resumptionChannels: { emitSessionStart: async () => {}, emitShutdown: async () => {} },
      })
      if (path === "park") {
        await lifecycle.reclaimIdleResidents?.()
      } else {
        await pi.dispatch("session_shutdown", { reason: "quit" },
          path === "normal" ? { sessionManager: { getSessionId: () => "parent-7" } } : {})
      }
      console.log(JSON.stringify({ path, pid: child.pid, alive: child.exitCode === null && child.signalCode === null, residency: store.load(record.task_id)?.residency_state }))
      expect(child.exitCode !== null || child.signalCode !== null).toBe(true)
      expect(store.load(record.task_id)?.status).toBe(record.status)
      expect(store.load(record.task_id)?.residency_state).toBe("rpc_detached")
      expect(store.load(record.task_id)?.killed).not.toBe(true)
      expect(store.load(sibling.task_id)).toEqual(sibling)
    } finally {
      lifecycle.dispose?.()
      await terminateRpcChild(child, { sigkillDelayMs: 100 })
      await exited
      console.log(`cleanup pid=${child.pid} exited=${child.exitCode !== null || child.signalCode !== null}`)
    }
  })
}
