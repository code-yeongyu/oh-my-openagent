import { afterEach, describe, expect, test } from "bun:test"

import { HostUnavailableError } from "./daemon"
import { HostSessionOpenError, SessionHeldElsewhereError } from "./session-client"
import { CHILD_CONTEXT, childOpenInput, sessionClientHarness } from "./session-client.test-support"

const harness = sessionClientHarness()
const { fakeHost, hostClient } = harness

afterEach(harness.release)

describe("HostSessionClient.open", () => {
  test("#given a daemon advertising the session capabilities #when open runs #then it probes, opens a worker session and reports the routing identity", async () => {
    // given
    const host = await fakeHost({ instanceId: "inst-7", engineVersion: "2026.9.18+1758000000.abc1234" })
    const client = hostClient(host)

    // when
    const opened = await client.open(childOpenInput("/tmp/sessions/a.jsonl"))

    // then
    expect(opened).toEqual({
      sessionId: "routing-1",
      attached: false,
      instanceId: "inst-7",
      engineVersion: "2026.9.18+1758000000.abc1234",
    })
    expect(client.sessionId).toBe("routing-1")
    expect(host.commands.map((command) => command.type)).toEqual(["get_protocol_info", "open_session"])
    expect(host.sessions()).toEqual([
      {
        routingId: "routing-1",
        sessionPath: "/tmp/sessions/a.jsonl",
        kind: "worker",
        context: CHILD_CONTEXT,
        retainOnDisconnect: true,
        autoTitle: false,
        attachments: 1,
        parked: false,
      },
    ])
  })

  test("#given a daemon without session_context #when open runs #then it refuses with a fallback-allowed capability error and opens nothing", async () => {
    // given
    const host = await fakeHost({ capabilities: ["multi_session", "extension_events", "session_kind"] })
    const client = hostClient(host)

    // when
    const refusal = await client.open(childOpenInput("/tmp/sessions/b.jsonl")).catch((error: unknown) => error)

    // then
    expect(refusal).toBeInstanceOf(HostUnavailableError)
    expect(refusal).toMatchObject({ reason: "capability", fallbackAllowed: true })
    expect(host.commands.map((command) => command.type)).toEqual(["get_protocol_info"])
  })

  test("#given a host holding the session path #when open runs #then it rejects with SessionHeldElsewhereError and never retries", async () => {
    // given
    const host = await fakeHost({
      openFailure: {
        code: "session_path_in_use",
        detail: "held by instance-b",
        data: { owner: "instance-b", retry_after_ms: 2_000 },
      },
    })
    const client = hostClient(host)

    // when
    const refusal = await client.open(childOpenInput("/tmp/sessions/c.jsonl")).catch((error: unknown) => error)

    // then
    expect(refusal).toBeInstanceOf(SessionHeldElsewhereError)
    expect(refusal).toMatchObject({ owner: "instance-b", retryAfterMs: 2_000, sessionPath: "/tmp/sessions/c.jsonl" })
    expect(host.commands.filter((command) => command.type === "open_session")).toHaveLength(1)
  })

  test("#given a host refusing the launch profile #when open runs #then it rejects with the typed open code", async () => {
    // given
    const host = await fakeHost({
      openFailure: { code: "invalid_launch_profile", detail: "auto_title must be a boolean" },
    })
    const client = hostClient(host)

    // when
    const refusal = await client.open(childOpenInput("/tmp/sessions/d.jsonl")).catch((error: unknown) => error)

    // then
    expect(refusal).toBeInstanceOf(HostSessionOpenError)
    expect(refusal).toMatchObject({ code: "invalid_launch_profile", sessionPath: "/tmp/sessions/d.jsonl" })
  })
})

describe("HostSessionClient transport", () => {
  test("#given an open retained session #when detach runs #then the host keeps the session and never sees close_session", async () => {
    // given
    const host = await fakeHost()
    const client = hostClient(host)
    await client.open(childOpenInput("/tmp/sessions/e.jsonl"))

    // when
    await client.detach()

    // then
    expect(host.commands.some((command) => command.type === "close_session")).toBe(false)
    expect(host.sessions().map((session) => session.sessionPath)).toEqual(["/tmp/sessions/e.jsonl"])
    expect(client.sessionId).toBeUndefined()
  })

  test("#given a session another client detached from #when a new client opens the same path #then the host reports it as attached", async () => {
    // given
    const host = await fakeHost()
    const first = hostClient(host)
    await first.open(childOpenInput("/tmp/sessions/f.jsonl"))
    await first.detach()

    // when
    const second = hostClient(host)
    const opened = await second.open(childOpenInput("/tmp/sessions/f.jsonl"))

    // then
    expect(opened.attached).toBe(true)
    expect(second.attached).toBe(true)
  })

  test("#given an open session #when close runs #then it issues close_session for the routing handle", async () => {
    // given
    const host = await fakeHost()
    const client = hostClient(host)
    const opened = await client.open(childOpenInput("/tmp/sessions/g.jsonl"))

    // when
    await client.close()

    // then
    const closes = host.commands.filter((command) => command.type === "close_session")
    expect(closes).toHaveLength(1)
    expect(closes[0]?.payload).toMatchObject({ sessionId: opened.sessionId })
    expect(host.sessions()).toEqual([])
    expect(client.sessionId).toBeUndefined()
  })

  test("#given an open session #when the host drops the connection #then transportGone resolves with the typed engine error", async () => {
    // given
    const host = await fakeHost()
    const client = hostClient(host)
    await client.open(childOpenInput("/tmp/sessions/h.jsonl"))

    // when
    host.crash()
    const gone = await client.transportGone

    // then
    expect(gone).toMatchObject({ code: "rpc_transport_gone" })
    expect(client.sessionId).toBeUndefined()
  })

  test("#given a command in flight #when the daemon dies under it #then the command rejects and transportGone resolves", async () => {
    // given
    const host = await fakeHost()
    const client = hostClient(host)
    await client.open(childOpenInput("/tmp/sessions/z.jsonl"))
    host.withholdReply("prompt")
    const reachedHost = host.waitForCommand("prompt")

    // when
    const inFlight = client.send({ type: "prompt", message: "go" })
    await reachedHost
    host.crash()

    // then
    await expect(inFlight).rejects.toMatchObject({ code: "rpc_transport_gone" })
    expect(await client.transportGone).toMatchObject({ code: "rpc_transport_gone" })
  })

  test("#given two children on one daemon #when both open #then each holds its own connection", async () => {
    // given
    const host = await fakeHost()
    const first = hostClient(host)
    const second = hostClient(host)

    // when
    await first.open(childOpenInput("/tmp/sessions/i.jsonl"))
    await second.open(childOpenInput("/tmp/sessions/j.jsonl"))

    // then
    expect(host.connections).toBe(2)
    expect(first.sessionId).not.toBe(second.sessionId)
  })
})
