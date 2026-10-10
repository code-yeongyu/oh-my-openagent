import { afterEach, describe, expect, test } from "bun:test"

import type { AgentSessionEvent } from "@code-yeongyu/senpi"

import { isRoutedTo, type HostSessionParked } from "./session-client"
import { childOpenInput, sessionClientHarness } from "./session-client.test-support"

const harness = sessionClientHarness()
const { fakeHost, hostClient } = harness

afterEach(harness.release)

describe("HostSessionClient records", () => {
  test("#given records tagged for other sessions #when the routing filter runs #then only own and untagged records pass", () => {
    // given / when / then
    expect(isRoutedTo({ type: "agent_end", sessionId: "routing-1" }, "routing-1")).toBe(true)
    expect(isRoutedTo({ type: "agent_end", sessionId: "routing-9" }, "routing-1")).toBe(false)
    expect(isRoutedTo({ type: "agent_end" }, "routing-1")).toBe(true)
  })

  test("#given a record tagged for another session #when it arrives on this connection #then no subscriber sees it", async () => {
    // given
    const host = await fakeHost()
    const client = hostClient(host)
    const opened = await client.open(childOpenInput("/tmp/sessions/k.jsonl"))
    const seen: AgentSessionEvent[] = []
    client.onEvent((event) => {
      seen.push(event)
    })

    // when
    host.emitRecord(opened.sessionId, { type: "agent_end", sessionId: "routing-999", willRetry: false })
    host.emitRecord(opened.sessionId, { type: "agent_end", willRetry: false })
    await client.getState()

    // then
    expect(seen.map((event) => event.type)).toEqual(["agent_end"])
  })

  test("#given a UI request on the session #when it arrives #then the deny is on the wire before the client's next command", async () => {
    // given
    const host = await fakeHost()
    const client = hostClient(host)
    const opened = await client.open(childOpenInput("/tmp/sessions/l.jsonl"))
    const answered = host.waitForCommand("extension_ui_response")
    const ingestedPastRequest = new Promise<void>((resolve) => {
      client.onEvent((event) => {
        if (event.type === "agent_end") resolve()
      })
    })

    // when
    host.requestUi(opened.sessionId, { id: "ui-1", method: "confirm", title: "Delete?", message: "really?" })
    host.emitRecord(opened.sessionId, { type: "agent_end", willRetry: false })
    await ingestedPastRequest
    await client.getState()

    // then
    // The record after the request has been delivered, so the request was already ingested; a deny
    // that waited on anything (a UI timeout, a timer) would reach the host after get_state.
    const order = host.commands.map((command) => command.type).filter((type) => type === "extension_ui_response" || type === "get_state")
    expect(order).toEqual(["extension_ui_response", "get_state"])
    expect((await answered).payload).toMatchObject({ type: "extension_ui_response", id: "ui-1", confirmed: false })
  })

  test("#given a question UI request #when it arrives #then the client answers cancelled without blocking its own commands", async () => {
    // given
    const host = await fakeHost()
    const client = hostClient(host)
    const opened = await client.open(childOpenInput("/tmp/sessions/m.jsonl"))
    const answered = host.waitForCommand("extension_ui_response")

    // when
    host.requestUi(opened.sessionId, { id: "ui-2", method: "question" })
    await client.getState()

    // then
    expect((await answered).payload).toMatchObject({ id: "ui-2", cancelled: true })
  })

  test("#given an idle retained session #when the host parks it #then onParked fires with the idle-sweep cause and the routing handle is released", async () => {
    // given
    const host = await fakeHost()
    const client = hostClient(host)
    const opened = await client.open(childOpenInput("/tmp/sessions/n.jsonl"))
    const parked: HostSessionParked[] = []
    const seen = new Promise<void>((resolve) => {
      client.onParked((event) => {
        parked.push(event)
        resolve()
      })
    })

    // when
    host.evict("/tmp/sessions/n.jsonl")
    await seen

    // then
    expect(parked).toEqual([{ sessionId: opened.sessionId, sessionPath: "/tmp/sessions/n.jsonl", reason: "idle_evicted" }])
    expect(client.sessionId).toBeUndefined()
  })

  test("#given a host shutting a session down #when session_closed arrives #then onClosed fires with the reason", async () => {
    // given
    const host = await fakeHost()
    const client = hostClient(host)
    const opened = await client.open(childOpenInput("/tmp/sessions/o.jsonl"))
    const closed = new Promise<{ readonly sessionId: string; readonly reason: string | undefined }>((resolve) => {
      client.onClosed(resolve)
    })

    // when
    host.closeSession(opened.sessionId, "host_shutdown")

    // then
    expect(await closed).toEqual({ sessionId: opened.sessionId, reason: "host_shutdown" })
    expect(client.sessionId).toBeUndefined()
  })
})

describe("HostSessionClient commands", () => {
  test("#given an open session #when send delivers each turn command #then the host receives the wire command tagged with the routing handle", async () => {
    // given
    const host = await fakeHost()
    const client = hostClient(host)
    const opened = await client.open(childOpenInput("/tmp/sessions/p.jsonl"))

    // when
    await client.send({ type: "prompt", message: "go", streamingBehavior: "steer" })
    await client.send({ type: "steer", message: "wait" })
    await client.send({ type: "followUp", message: "later" })
    await client.send({ type: "abort" })

    // then
    const delivered = host.commands.filter(
      (command) => command.type !== "get_protocol_info" && command.type !== "open_session",
    )
    expect(delivered.map((command) => command.type)).toEqual(["prompt", "steer", "follow_up", "abort"])
    expect(delivered.every((command) => command.sessionId === opened.sessionId)).toBe(true)
    expect(delivered[0]?.payload).toMatchObject({ message: "go", streamingBehavior: "steer" })
  })

  test("#given an open session #when the session queries run #then entries, state and switch_session round-trip", async () => {
    // given
    const host = await fakeHost()
    const client = hostClient(host)
    await client.open(childOpenInput("/tmp/sessions/q.jsonl"))

    // when
    const entries = await client.getEntries("entry-3")
    const state = await client.getState()
    const switched = await client.switchSession("/tmp/sessions/q2.jsonl")

    // then
    expect(entries).toEqual({ entries: [], leafId: null })
    expect(state.sessionId).toBe("durable-routing-1")
    expect(switched).toEqual({ cancelled: false })
    expect(host.commands.find((command) => command.type === "get_entries")?.payload).toMatchObject({ since: "entry-3" })
  })
})
