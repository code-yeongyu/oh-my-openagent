import { afterEach, describe, expect, test } from "bun:test"

import type { AgentSessionEvent } from "@code-yeongyu/senpi"

import { childOpenInput, sessionClientHarness } from "./session-client.test-support"

const harness = sessionClientHarness()
const { fakeHost, hostClient } = harness

afterEach(harness.release)

describe("HostSessionClient model event forwarding (F12)", () => {
  test("#given an open session #when the host pushes model_changed and retry_fallback_reverted #then both reach session subscribers with their payloads", async () => {
    // given
    const host = await fakeHost()
    const client = hostClient(host)
    const opened = await client.open(childOpenInput("/tmp/sessions/f12-model.jsonl"))
    const seen: AgentSessionEvent[] = []
    client.onEvent((event) => {
      seen.push(event)
    })

    // when
    host.emitRecord(opened.sessionId, {
      type: "model_changed",
      model: { provider: "anthropic", id: "claude-opus-5-5" },
      thinkingLevel: "high",
      source: "set",
    })
    host.emitRecord(opened.sessionId, {
      type: "retry_fallback_reverted",
      from: "anthropic/claude-opus-5-5",
      to: "kimi-coding/kimi-for-coding-highspeed-unlocked",
    })
    await client.getState()

    // then
    expect(seen.map((event) => event.type)).toEqual(["model_changed", "retry_fallback_reverted"])
    expect(seen[0]).toMatchObject({
      type: "model_changed",
      model: { provider: "anthropic", id: "claude-opus-5-5" },
      thinkingLevel: "high",
      source: "set",
    })
    expect(seen[1]).toMatchObject({
      type: "retry_fallback_reverted",
      from: "anthropic/claude-opus-5-5",
      to: "kimi-coding/kimi-for-coding-highspeed-unlocked",
    })
  })
})
