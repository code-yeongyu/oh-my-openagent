import { afterEach, describe, expect, test } from "bun:test"
import type { AgentSessionEvent } from "@code-yeongyu/senpi"
import type { ChildExtensionEvent } from "../child-extension-events"
import { childOpenInput, sessionClientHarness } from "./session-client.test-support"
import { createHostSessionHandle } from "./handle"

const harness = sessionClientHarness()
afterEach(harness.release)

describe("daemon child extension-event delivery", () => {
  test("retains a permission denial until its owner subscribes without changing agent events", async () => {
    // given
    const host = await harness.fakeHost()
    const client = harness.hostClient(host)
    const opened = await client.open(childOpenInput("/tmp/permission-child.jsonl"))
    const handle = createHostSessionHandle({
      client, session: { routingId: opened.sessionId, sessionPath: "/tmp/permission-child.jsonl", instanceId: opened.instanceId },
      taskId: "st_permission", heartbeatIntervalMs: 60_000, now: Date.now, closeGraceMs: 100,
      openDisposition: "reopened",
    })
    const agentEvents: AgentSessionEvent[] = []
    handle.subscribe((event) => agentEvents.push(event))
    const event: ChildExtensionEvent = { type: "computer.permission_required", permission: "accessibility", app: "Test App" }
    try {
      // when: delivery precedes manager ownership, as it can during the initial prompt.
      host.emitRecord(opened.sessionId, { type: "extension_event", name: event.type, data: event })
      host.emitRecord(opened.sessionId, { type: "agent_start" })
      await client.getState()
      const relayed: ChildExtensionEvent[] = []
      handle.subscribeExtensionEvents?.((record) => relayed.push(record))
      // then
      expect(relayed).toEqual([event])
      expect(agentEvents.map((record) => record.type)).toEqual(["agent_start"])
    } finally {
      await handle.detach()
    }
  })

  test("drops malformed and foreign-session permission records at the wire boundary", async () => {
    // given
    const host = await harness.fakeHost()
    const client = harness.hostClient(host)
    const opened = await client.open(childOpenInput("/tmp/invalid-permission-child.jsonl"))
    const relayed: ChildExtensionEvent[] = []
    client.onExtensionEvent((event) => relayed.push(event))
    // when
    const valid = { type: "computer.permission_required", permission: "screen_recording" }
    for (const data of [null, {}, { ...valid, permission: "camera" }, { ...valid, app: 42 }]) {
      host.emitRecord(opened.sessionId, { type: "extension_event", name: "computer.permission_required", data })
    }
    host.emitRecord(opened.sessionId, {
      type: "extension_event", sessionId: "another-child", name: "computer.permission_required", data: valid,
    })
    await client.getState()
    // then
    expect(relayed).toEqual([])
  })
})
