import { afterEach, describe, expect, test } from "bun:test"

import type { TaskStatus } from "../state"
import { createTaskLifecycle } from "./create"
import { OrderRegistry } from "./__fixtures__/shutdown-order"
import { cleanupProjects, seedRecord, settings, tempStore, type CallLog } from "./__fixtures__/lifecycle-fakes"
import { NO_HOST_ENDPOINT } from "./host-session"
import { openHostSessionHandle } from "../runners/rpc-host/handle.test-support"
import { childOpenInput, sessionClientHarness } from "../runners/rpc-host/session-client.test-support"

const harness = sessionClientHarness()
afterEach(async () => {
  await harness.release()
  cleanupProjects()
})

const PARENT_SESSION = "parent-1"
const CHILD_TASK = "st_000000a1"
const CHILD_PATH = "/tmp/stopped-owner-child.jsonl"

// The session shutting down belongs to a task of its own (the record whose child_session_id is that
// session). Its hosted child is mid-turn on the host, the way a grandchild is when the root cancels
// its parent task: the cancel closes the parent's session, whose session_shutdown runs this.
// ownerSessionRecorded=false is the live hosted shape: the host reports the durable session id only
// later, so the owner record has no child_session_id and the session knows itself by its task id.
async function world(ownerStatus: TaskStatus, ownerKilled = false, cancelRequested = false, ownerSessionRecorded = true) {
  const host = await harness.fakeHost()
  const handle = await openHostSessionHandle({ client: harness.hostClient(host), sessionPath: CHILD_PATH })
  await handle.startInitialPrompt("keep working")
  const store = tempStore()
  seedRecord(store, {
    task_id: "st_000000b0", parent_session_id: "root-1", status: ownerStatus, killed: ownerKilled,
    execution_mode: "process", runner_kind: "host-session", host_pid: process.pid,
    ...(ownerSessionRecorded ? { child_session_id: PARENT_SESSION } : {}),
  })
  if (cancelRequested) store.mutate("st_000000b0", (owner) => ({ ...owner, cancel_requested: { requested_at: new Date().toISOString() } }))
  seedRecord(store, {
    task_id: CHILD_TASK, parent_session_id: PARENT_SESSION, status: "running", execution_mode: "process",
    runner_kind: "host-session", residency_state: "resident", host_pid: process.pid,
  })
  const order: CallLog = []
  const registry = new OrderRegistry(order)
  registry.add({
    task_id: CHILD_TASK, kind: "host-session", pid: undefined,
    abort: () => handle.abort(), dispose: () => handle.dispose(), terminate: () => handle.terminate(),
    markStopping: () => order.push(`markStopping:${CHILD_TASK}`),
  })
  const lifecycle = createTaskLifecycle({ hostEndpoint: NO_HOST_ENDPOINT, store, registry, config: settings() })
  return { host, store, registry, lifecycle, order }
}

describe("session shutdown of a deliberately stopped task's session", () => {
  for (const [label, status, killed, requested, recorded] of [
    ["cancelled", "cancelled", false, false, true], ["lost", "lost", false, false, true], ["killed", "error", true, false, true],
    // The unreachable-child stop and the revival's pending cancel close the session while the owner
    // still reads running with only cancel_requested set.
    ["still running with a cancel requested", "running", false, true, true],
    // The live hosted path (#10818): the owner record never got child_session_id.
    ["cancelled and hosted, known only by its task id", "cancelled", false, false, false],
  ] as const) {
    test(`#given the session's own task is ${label} #when it shuts down #then its hosted child is stopped, not detached`, async () => {
      const { host, store, registry, lifecycle, order } = await world(status, killed, requested, recorded)

      const summary = await lifecycle.suspendOnSessionShutdown({
        parentSessionId: PARENT_SESSION, reason: "quit", ...(recorded ? {} : { ownTaskId: "st_000000b0" }),
      })

      const sent = host.commands.map((command) => command.type)
      expect(sent).toContain("abort")
      expect(sent).toContain("close_session")
      expect(store.load(CHILD_TASK)?.status).toBe("cancelled")
      expect(store.load(CHILD_TASK)?.residency_state).not.toBe("rpc_detached")
      expect(summary.disposed).toBe(1)
      expect(summary.suspended_rpc).toBe(0)
      expect(registry.get(CHILD_TASK)).toBeUndefined()
      expect(order).toContain(`markStopping:${CHILD_TASK}`)
    })
  }

  test("#given the session's own task completed #when it quits #then its hosted child detaches so task_send can still collect it", async () => {
    const { host, store, lifecycle } = await world("completed")
    const detached = host.waitForConnections(0)

    const summary = await lifecycle.suspendOnSessionShutdown({ parentSessionId: PARENT_SESSION, reason: "quit" })
    await detached

    expect(host.commands.filter((command) => command.type === "abort")).toHaveLength(0)
    expect(store.load(CHILD_TASK)?.residency_state).toBe("rpc_detached")
    expect(summary.suspended_rpc).toBe(1)
  })

  test("#given the session's own task is still running #when it quits #then its hosted child keeps its turn and detaches", async () => {
    const { host, store, lifecycle } = await world("running")
    const detached = host.waitForConnections(0)

    const summary = await lifecycle.suspendOnSessionShutdown({ parentSessionId: PARENT_SESSION, reason: "quit" })
    await detached

    expect(host.commands.filter((command) => command.type === "abort")).toHaveLength(0)
    expect(host.commands.filter((command) => command.type === "close_session")).toHaveLength(0)
    const observer = harness.hostClient(host)
    await observer.open(childOpenInput(CHILD_PATH))
    expect((await observer.getState()).isStreaming).toBe(true)
    expect(store.load(CHILD_TASK)?.status).toBe("running")
    expect(store.load(CHILD_TASK)?.residency_state).toBe("rpc_detached")
    expect(summary.suspended_rpc).toBe(1)
  })
})
