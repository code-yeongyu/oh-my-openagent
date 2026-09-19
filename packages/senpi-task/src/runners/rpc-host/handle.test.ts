import { afterEach, describe, expect, test } from "bun:test"

import type { ChildExitFacts } from "../types"
import { classifySessionExit, type SessionExitClassification, type SessionExitInput } from "./exit-mapping"
import { FAKE_SESSION, fakeSessionPort, handleOverPort, openHostSessionHandle } from "./handle.test-support"
import type { HostSessionParked } from "./session-client"
import { sessionClientHarness } from "./session-client.test-support"

const harness = sessionClientHarness()
const { fakeHost, hostClient } = harness

afterEach(harness.release)

function facts(stderrTail: string): ChildExitFacts {
  return { pid: undefined, code: null, signal: null, stderrTail }
}

type MappingRow = {
  readonly given: string
  readonly then: string
  readonly input: SessionExitInput
  readonly expected: SessionExitClassification
}

const MAPPING_ROWS: readonly MappingRow[] = [
  {
    given: "the host confirms the close this client asked for",
    then: "the exit is clean",
    input: { cause: { kind: "session_closed", reason: "client_close" }, intent: "closed" },
    expected: { disposition: "exit", outcome: { kind: "clean", facts: facts("client_close") } },
  },
  {
    given: "the host confirms the close a terminate asked for",
    then: "the exit is killed",
    input: { cause: { kind: "session_closed", reason: "client_close" }, intent: "terminated" },
    expected: { disposition: "exit", outcome: { kind: "killed", facts: facts("client_close") } },
  },
  {
    given: "the daemon shuts down under a live session",
    then: "the exit is crashed and carries the reason",
    input: { cause: { kind: "session_closed", reason: "host_shutdown" }, intent: "running" },
    expected: { disposition: "exit", outcome: { kind: "crashed", facts: facts("host_shutdown") } },
  },
  {
    given: "the daemon closes a live session with an error",
    then: "the exit is crashed and carries the reason",
    input: { cause: { kind: "session_closed", reason: "error" }, intent: "running" },
    expected: { disposition: "exit", outcome: { kind: "crashed", facts: facts("error") } },
  },
  {
    given: "the connection to the daemon is lost under a live session",
    then: "the exit is crashed with a transport_gone tail",
    input: { cause: { kind: "transport_gone" }, intent: "running" },
    expected: { disposition: "exit", outcome: { kind: "crashed", facts: facts("transport_gone") } },
  },
  {
    given: "the session never opened",
    then: "the exit is a spawn error carrying the refusal",
    input: { cause: { kind: "open_failed", message: "invalid_launch_profile" }, intent: "running" },
    expected: {
      disposition: "exit",
      outcome: { kind: "spawn_error", message: "invalid_launch_profile", facts: facts("invalid_launch_profile") },
    },
  },
  {
    given: "the daemon parks an idle session",
    then: "it is not an exit at all",
    input: { cause: { kind: "session_parked" }, intent: "running" },
    expected: { disposition: "parked" },
  },
  {
    given: "a handoff parks the session",
    then: "it is not an exit at all",
    input: { cause: { kind: "session_closed", reason: "handoff_parked" }, intent: "running" },
    expected: { disposition: "parked" },
  },
  {
    given: "the idle sweep evicts the session",
    then: "it is not an exit at all",
    input: { cause: { kind: "session_closed", reason: "idle_evicted" }, intent: "running" },
    expected: { disposition: "parked" },
  },
  {
    given: "the idle sweep evicts a session a terminate is already closing",
    then: "parking still wins over the terminate intent",
    input: { cause: { kind: "session_closed", reason: "idle_evicted" }, intent: "terminated" },
    expected: { disposition: "parked" },
  },
]

describe("classifySessionExit", () => {
  for (const row of MAPPING_ROWS) {
    test(`#given ${row.given} #when the session ends #then ${row.then}`, () => {
      // given / when
      const classified = classifySessionExit(row.input)

      // then
      expect(classified).toEqual(row.expected)
    })
  }
})

describe("createHostSessionHandle over a daemon session", () => {
  test("#given an open session #when the handle is built #then it reports host-session facts and never a pid", async () => {
    // given
    const host = await fakeHost({ instanceId: "inst-7" })
    const client = hostClient(host)

    // when
    const handle = await openHostSessionHandle({ client, sessionPath: "/tmp/sessions/a.jsonl" })

    // then
    expect(handle.pid).toBeUndefined()
    expect(handle.kind).toBe("host-session")
    expect(handle.attached).toBe(true)
    expect(handle.hostSession).toEqual({
      socket: host.socketPath,
      routingId: "routing-1",
      sessionPath: "/tmp/sessions/a.jsonl",
      instanceId: "inst-7",
    })
    await handle.dispose()
  })

  test("#given an idle completed session #when the daemon parks it #then onParked fires, the handle detaches and no exit is produced", async () => {
    // given
    const host = await fakeHost()
    const client = hostClient(host)
    const handle = await openHostSessionHandle({ client, sessionPath: "/tmp/sessions/b.jsonl" })
    const parked: HostSessionParked[] = []
    handle.onParked((park) => parked.push(park))

    // when
    host.evict("/tmp/sessions/b.jsonl")
    // A reply on the SAME connection cannot overtake the park record that preceded it.
    await client.getState()

    // then
    expect(parked).toEqual([{ sessionId: "routing-1", sessionPath: "/tmp/sessions/b.jsonl" }])
    expect(handle.exitOutcome()).toBeUndefined()
    expect(handle.attached).toBe(false)
    await handle.dispose()
  })

  test("#given a parked session #when the daemon dies afterwards #then the parked child is still not an exit", async () => {
    // given
    const host = await fakeHost()
    const client = hostClient(host)
    const handle = await openHostSessionHandle({ client, sessionPath: "/tmp/sessions/c.jsonl" })
    const parked: HostSessionParked[] = []
    handle.onParked((park) => parked.push(park))
    host.evict("/tmp/sessions/c.jsonl")
    await client.getState()
    expect(parked).toHaveLength(1)

    // when
    host.crash()
    await client.transportGone

    // then
    expect(handle.exitOutcome()).toBeUndefined()
    expect(handle.attached).toBe(false)
    await handle.dispose()
  })

  test("#given a turn in flight #when the transport is lost #then the exit is crashed and the turn settles as an error", async () => {
    // given
    const host = await fakeHost()
    const client = hostClient(host)
    const handle = await openHostSessionHandle({ client, sessionPath: "/tmp/sessions/d.jsonl" })
    host.withholdReply("prompt")
    const reachedHost = host.waitForCommand("prompt")
    const started = handle.startInitialPrompt("do the work")
    await reachedHost

    // when
    host.crash()

    // then
    await expect(started).rejects.toMatchObject({ code: "rpc_transport_gone" })
    expect(await handle.waitForExit()).toEqual({ kind: "crashed", facts: facts("transport_gone") })
    expect((await handle.waitForOutcome()).status).toBe("error")
    expect(handle.attached).toBe(false)
    await handle.dispose()
  })

  test("#given a live session #when the daemon closes it with host_shutdown #then the exit is crashed with that reason", async () => {
    // given
    const host = await fakeHost()
    const client = hostClient(host)
    const handle = await openHostSessionHandle({ client, sessionPath: "/tmp/sessions/e.jsonl" })

    // when
    host.closeSession("routing-1", "host_shutdown")

    // then
    expect(await handle.waitForExit()).toEqual({ kind: "crashed", facts: facts("host_shutdown") })
    await handle.dispose()
  })

  test("#given a finished child #when close ends the session #then close_session is sent and the exit is clean", async () => {
    // given
    const host = await fakeHost()
    const client = hostClient(host)
    const handle = await openHostSessionHandle({ client, sessionPath: "/tmp/sessions/f.jsonl" })

    // when
    await handle.close()

    // then
    expect(host.commands.map((command) => command.type)).toEqual([
      "get_protocol_info",
      "open_session",
      "close_session",
    ])
    expect(handle.exitOutcome()).toEqual({ kind: "clean", facts: facts("client_close") })
    expect(handle.attached).toBe(false)
    await handle.dispose()
  })

  test("#given a running child #when terminate runs #then it aborts, closes the session and reports killed - never a signal", async () => {
    // given
    const host = await fakeHost()
    const client = hostClient(host)
    const handle = await openHostSessionHandle({ client, sessionPath: "/tmp/sessions/g.jsonl" })

    // when
    await handle.terminate()

    // then
    const issued = host.commands
      .map((command) => command.type)
      .filter((type) => type === "abort" || type === "close_session")
    expect(issued).toEqual(["abort", "close_session"])
    expect(handle.exitOutcome()).toEqual({ kind: "killed", facts: facts("terminated") })
    await handle.dispose()
  })

  test("#given a daemon that answers nothing #when terminate runs #then it still resolves inside the close grace plus the abort grace", async () => {
    // given
    const host = await fakeHost()
    const client = hostClient(host)
    const closeGraceMs = 50
    const handle = await openHostSessionHandle({ client, sessionPath: "/tmp/sessions/h.jsonl", closeGraceMs })
    host.withholdReply("abort")
    host.withholdReply("close_session")

    // when
    const startedAt = performance.now()
    await handle.terminate()
    const elapsedMs = performance.now() - startedAt

    // then
    expect(elapsedMs).toBeLessThan(closeGraceMs + 2_000 + 1_000)
    expect(host.commands.filter((command) => command.type === "close_session")).toHaveLength(1)
    expect(handle.exitOutcome()).toEqual({ kind: "killed", facts: facts("terminated") })
    await handle.dispose()
  })

  test("#given a session the daemon parked #when the manager terminates the child #then the teardown still ends it as killed", async () => {
    // given
    const host = await fakeHost()
    const client = hostClient(host)
    const handle = await openHostSessionHandle({ client, sessionPath: "/tmp/sessions/j.jsonl", closeGraceMs: 50 })
    host.evict("/tmp/sessions/j.jsonl")
    await client.getState()
    expect(handle.exitOutcome()).toBeUndefined()

    // when
    await handle.terminate()

    // then
    expect(handle.exitOutcome()).toEqual({ kind: "killed", facts: facts("terminated") })
    expect(handle.attached).toBe(false)
    await handle.dispose()
  })

  test("#given a parent shutting down #when the handle detaches #then the session stays open on the daemon with no exit", async () => {
    // given
    const host = await fakeHost()
    const client = hostClient(host)
    const handle = await openHostSessionHandle({ client, sessionPath: "/tmp/sessions/i.jsonl" })

    // when
    await handle.detach()

    // then
    expect(host.commands.some((command) => command.type === "close_session")).toBe(false)
    expect(host.sessions().map((session) => session.sessionPath)).toEqual(["/tmp/sessions/i.jsonl"])
    expect(handle.exitOutcome()).toBeUndefined()
    expect(handle.attached).toBe(false)
  })
})

describe("host session heartbeat resilience", () => {
  test("#given a connection that dropped under the beat #when the heartbeat reads state #then the in-place throw is contained and the child still exits cleanly", async () => {
    // given: a real SessionClient throws `HostSessionDetachedError` in place - it never returns a
    // rejected promise - so a beat tick racing teardown used to escape the timer callback as an
    // uncaughtException and killed the parent. The fixture mirrors exactly that throw.
    const port = fakeSessionPort()
    const handle = handleOverPort(port, 5)
    port.failStateWithSyncThrow()

    // when: two beat ticks attempt the doomed read
    await port.stateRead(2)

    // then: nothing escaped the timer callback, and the child still reaches its daemon-driven exit
    port.emitClosed({ sessionId: FAKE_SESSION.routingId, reason: "host_shutdown" })
    expect(await handle.waitForExit()).toEqual({ kind: "crashed", facts: facts("host_shutdown") })
    await handle.dispose()
  })
})
