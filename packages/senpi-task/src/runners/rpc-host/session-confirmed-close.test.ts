import { afterEach, expect, test } from "bun:test"
import { adaptRpcHandle } from "../../manager/child-handle"
import { baseSpec, categoryPlanner, cleanupProjects, settings, tempProject } from "../../manager/__fixtures__/manager-fakes"
import { createTaskManager } from "../../manager/manager"
import { createTaskRecordStore } from "../../store"
import { fakeClock } from "../rpc/__fixtures__/clock"
import { createHostSessionHandle } from "./handle"
import { HostSessionClient } from "./session-client"
import type { HostRpcClient } from "./session-transport"
import { childOpenInput, sessionClientHarness } from "./session-client.test-support"
import { FAKE_HOST_CAPABILITIES } from "./__fixtures__/fake-host-probe"

const harness = sessionClientHarness()
const clients: HostSessionClient[] = []
let clock: ReturnType<typeof fakeClock> | undefined
afterEach(async () => {
  clock?.restore()
  clock = undefined
  for (const client of clients.splice(0)) await client.detach()
  await harness.release()
  cleanupProjects()
})

async function closureFixture(hostState: "answers" | "stalled" | "gone", acked: boolean, listed: boolean) {
  const hanging = Promise.withResolvers<never>()
  const route = "closing-session"
  const events = new Set<(record: unknown) => void>()
  const listings: boolean[] = []
  let onClose = () => {}
  const unexpected = (): never => { throw new Error("unexpected RPC command") }
  const rpc: HostRpcClient = {
    start: async () => {},
    stop: async () => {},
    onEvent: listener => { events.add(listener); return () => { events.delete(listener) } },
    openSession: async () => ({ sessionId: route, attached: true }),
    closeSession: async () => {
      onClose()
      if (!acked) throw new Error("close refused")
    },
    listSessions: async options => {
      listings.push(options.include_workers)
      if (hostState === "gone") throw new Error("host unreachable")
      if (hostState === "stalled") return hanging.promise
      return listed ? [{ sessionId: route }] : []
    },
    getState: () => hanging.promise,
    abort: async () => {},
    setSessionContext: async () => {},
    prompt: unexpected, steer: unexpected, followUp: unexpected,
    sendExtensionUIResponse: unexpected, getAvailableModels: unexpected,
    getEntries: unexpected, switchSession: unexpected,
  }
  const client = new HostSessionClient({
    socketPath: "/tmp/confirmed-close/rpc.sock",
    ports: {
      probeProtocolInfo: async () => ({
        protocolVersion: 1, instanceId: "close-proof", generation: 1,
        engineVersion: "2026.9.18", engineOrdinal: [2026, 9, 18, 0, 0],
        capabilities: [...FAKE_HOST_CAPABILITIES],
      }),
      createClient: async () => rpc,
    },
  })
  clients.push(client)
  const path = "/tmp/sessions/close-proof.jsonl"
  const opened = await client.open(childOpenInput(path))
  clock = fakeClock()
  const handle = createHostSessionHandle({
    client, session: { routingId: opened.sessionId, sessionPath: path, instanceId: opened.instanceId },
    taskId: "st_close_proof", heartbeatIntervalMs: 10_000, now: clock.now,
    closeGraceMs: 100, openDisposition: "attached",
  })
  const notices: string[] = []
  const project = tempProject()
  const runner = { start: async (spec: { taskId: string }) => ({ ...adaptRpcHandle(handle), task_id: spec.taskId }) }
  const manager = createTaskManager({
    store: createTaskRecordStore({ project_dir: project }),
    runners: { "in-process": runner, process: runner }, planner: categoryPlanner(),
    config: settings(), cwd: project,
    onChildLiveness: (_record, status) => { notices.push(status.state) },
  })
  const started = await manager.start(baseSpec({ execution_mode: "process", run_in_background: true }))
  if (started.kind !== "started") throw new Error("expected started")
  return {
    handle, manager, notices, listings, taskId: started.task_id, clock,
    closeFrame: (reason: string) => { onClose = () => { for (const listener of events) listener({ type: "session_closed", sessionId: route, reason }) } },
    dispose: async () => { manager.forget(started.task_id, { path: "park" }); await handle.dispose() },
  }
}

for (const host of ["answers", "stalled", "gone"] as const) {
  for (const acked of [true, false]) {
    for (const listed of [true, false]) {
      test(`authoritative close: host ${host}, close ${acked ? "acked" : "failed"}, session ${listed ? "listed" : "absent"}`, async () => {
        // Given independent close acknowledgements and host state, never infer one from the other.
        const fixture = await closureFixture(host, acked, listed)
        try {
          // When the liveness deadline requests closure.
          await fixture.clock.advance(170_000)
          // Then only a live post-close absence permits terminal settlement.
          const confirmed = host === "answers" && !listed
          expect(fixture.handle.hasExited()).toBe(confirmed)
          expect(fixture.notices).toEqual(["unresponsive", "terminal-pending"])
          if (!confirmed) {
            expect(fixture.manager.get(fixture.taskId)?.status).toBe("running")
            expect(fixture.manager.get(fixture.taskId)?.host_liveness?.state).toBe("terminal-pending")
          } else {
            expect(await fixture.handle.waitForOutcome()).toMatchObject({ status: "error", failure: { kind: "child-unresponsive" } })
          }
          expect(fixture.listings.length).toBeGreaterThan(0)
          expect(fixture.listings.every(includeWorkers => includeWorkers)).toBe(true)
        } finally {
          await fixture.dispose()
        }
      })
    }
  }
}

for (const reason of ["handoff_parked", "client_close"]) {
  test(`a ${reason} frame cannot confirm an overdue session that remains listed`, async () => {
    // Given a host that acknowledges close and emits a lifecycle hint but still lists the session.
    const fixture = await closureFixture("answers", true, true)
    fixture.closeFrame(reason)
    try {
      // When the frame arrives during close, it is not authoritative proof.
      await fixture.clock.advance(170_000)
      expect(fixture.handle.hasExited()).toBe(false)
      expect(fixture.handle.liveness().state).toBe("terminal-pending")
      expect(fixture.listings).toEqual([true])
      expect(fixture.notices).toEqual(["unresponsive", "terminal-pending"])
    } finally {
      await fixture.dispose()
    }
  })
}

test("a transport cut swallowed by the engine close never proves a retained session ended", async () => {
  // Given a real RPC client and a retained session whose close command is withheld.
  const host = await harness.fakeHost()
  const client = harness.hostClient(host)
  await client.open(childOpenInput("/tmp/sessions/close-cut.jsonl"))
  host.withholdReply("close_session")
  const received = host.waitForCommand("close_session")
  const closing = client.closeConfirmed().then(() => "confirmed", () => "unconfirmed")
  await received
  // When the connection disappears mid-close, the engine may swallow that transport error.
  host.cutConnections()
  await client.transportGone
  // Then the still-live session is not reported closed.
  expect(await closing).toBe("unconfirmed")
  expect(host.sessions()).toHaveLength(1)
})

test("a refused confirmed close keeps the same session route available for retry", async () => {
  const host = await harness.fakeHost()
  const client = harness.hostClient(host)
  const opened = await client.open(childOpenInput("/tmp/sessions/confirmed-close.jsonl"))
  host.failReply("close_session", "host_draining")
  const refusal = await client.closeConfirmed().catch((error: unknown) => error)
  expect(refusal).toBeInstanceOf(Error)
  expect(client.sessionId).toBe(opened.sessionId)
  expect(host.sessions()).toHaveLength(1)
  host.failReply("close_session", undefined)
  await client.closeConfirmed()
  expect(host.sessions()).toHaveLength(0)
  expect(host.commands.filter(command => command.type === "open_session")).toHaveLength(1)
  expect(host.commands.filter(command => command.type === "close_session")).toHaveLength(2)
})
