import { afterEach, describe, expect, test } from "bun:test"

import { createTaskLifecycle } from "./create"
import { OrderRegistry } from "./__fixtures__/shutdown-order"
import { cleanupProjects, fakeHandle, seedRecord, settings, tempStore, type CallLog } from "./__fixtures__/lifecycle-fakes"
import { NO_HOST_ENDPOINT } from "./host-session"
import { openHostSessionHandle } from "../runners/rpc-host/handle.test-support"
import { childOpenInput, sessionClientHarness } from "../runners/rpc-host/session-client.test-support"

const harness = sessionClientHarness()
afterEach(async () => {
  await harness.release()
  cleanupProjects()
})

describe("daemon shutdown detachment", () => {
  test("#given automatic revival disabled #when the parent quits #then daemon work still detaches without abort", async () => {
    const store = tempStore()
    seedRecord(store, {
      task_id: "st_000000a1", status: "running", execution_mode: "process",
      runner_kind: "host-session", host_pid: process.pid,
    })
    const order: CallLog = []
    const registry = new OrderRegistry(order)
    registry.add(fakeHandle("st_000000a1", "host-session", order))
    const lifecycle = createTaskLifecycle({
      hostEndpoint: NO_HOST_ENDPOINT, store, registry, config: settings({ resume_children: false }),
    })
    const summary = await lifecycle.suspendOnSessionShutdown({ parentSessionId: "parent-1", reason: "quit" })
    expect(order).toEqual(["forget:st_000000a1", "dispose:st_000000a1"])
    expect(summary.suspended_rpc).toBe(1)
    expect(store.load("st_000000a1")?.residency_state).toBe("rpc_detached")
  })
  for (const reason of ["new", "quit", "reload", "resume", "fork"]) {
    test(`#given a streaming retained daemon child #when shutdown reason is ${reason} #then detach leaves the host turn running`, async () => {
      const host = await harness.fakeHost()
      const client = harness.hostClient(host)
      const handle = await openHostSessionHandle({ client, sessionPath: "/tmp/shutdown-child.jsonl" })
      await handle.startInitialPrompt("keep working")
      const taskId = "st_000000a1"
      const store = tempStore()
      seedRecord(store, {
        task_id: taskId, status: "running", execution_mode: "process",
        runner_kind: "host-session", residency_state: "resident", host_pid: process.pid,
      })
      const order: CallLog = []
      const registry = new OrderRegistry(order)
      registry.add({
        task_id: taskId, kind: "host-session", pid: undefined,
        abort: () => handle.abort(), dispose: () => handle.dispose(), terminate: () => handle.terminate(),
      })
      const lifecycle = createTaskLifecycle({ hostEndpoint: NO_HOST_ENDPOINT, store, registry, config: settings() })
      const detached = host.waitForConnections(0)
      await lifecycle.suspendOnSessionShutdown({ parentSessionId: "parent-1", reason })
      await detached

      expect(host.commands.filter((command) => command.type === "abort")).toHaveLength(0)
      expect(host.commands.filter((command) => command.type === "close_session")).toHaveLength(0)
      const observer = harness.hostClient(host)
      await observer.open(childOpenInput("/tmp/shutdown-child.jsonl"))
      expect((await observer.getState()).isStreaming).toBe(true)
      expect(store.load(taskId)?.status).toBe("running")
      expect(store.load(taskId)?.residency_state).toBe("rpc_detached")
      expect(registry.get(taskId)).toBeUndefined()
    })
  }
})
