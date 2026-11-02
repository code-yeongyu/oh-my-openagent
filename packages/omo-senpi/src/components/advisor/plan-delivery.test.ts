/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import { setup, SESSION, toolResults } from "./advisor.test-support"

describe("advisor plan delivery and session isolation", () => {
  it("#given a held plan #when the run settles before the next tool result #then the plan is dropped, not steered", async () => {
    const h = setup({ advisor: { enabled: true, min_calls: 1 }, key: "k" })
    const held = h.nextEntry()
    await toolResults(h.pi, 1)
    await held
    await h.pi.dispatch("agent_settled", { type: "agent_settled" }, SESSION)
    await toolResults(h.pi, 1)
    expect(h.pi.messages).toHaveLength(0)
    expect(h.deliveries).toEqual([{ version: 1, delivered: false, reason: "settled", firedAt: 1 }])
  })

  it("#given a held plan #when the next tool result arrives while the session is idle #then it is not steered", async () => {
    const h = setup({ advisor: { enabled: true, min_calls: 1 }, key: "k" })
    const held = h.nextEntry()
    await toolResults(h.pi, 1)
    await held
    await h.pi.dispatch("tool_result", { type: "tool_result", toolName: "read", input: {}, content: "ok", isError: false }, { ...SESSION, isIdle: () => true })
    expect(h.pi.messages).toHaveLength(0)
  })

  it("#given a delivered plan #when tool results follow #then the cooldown counts from delivery", async () => {
    const h = setup({ advisor: { enabled: true, min_calls: 1, cooldown: 3 }, key: "k" })
    const held = h.nextEntry()
    await toolResults(h.pi, 1)
    await held
    await toolResults(h.pi, 3)
    expect(h.pi.messages).toHaveLength(1)
    expect(h.fetchBodies).toHaveLength(1)
    const next = h.nextEntry()
    await toolResults(h.pi, 1)
    await next
    expect(h.fetchBodies).toHaveLength(2)
  })

  it("#given two sessions #when one is stuck #then the other's window and in-flight state stay separate", async () => {
    const h = setup({ advisor: { enabled: true, min_calls: 2 }, probability: 0.1, key: "k" })
    const other = { cwd: "/repo", sessionManager: { getSessionId: () => "s-2" } }
    await h.pi.dispatch("tool_result", { type: "tool_result", toolName: "bash", input: { command: "make" }, content: "error", isError: true }, SESSION)
    await h.pi.dispatch("tool_result", { type: "tool_result", toolName: "read", input: { path: "a" }, content: "ok", isError: false }, other)
    expect(h.fetchBodies).toHaveLength(0)
    const entry = h.nextEntry()
    await h.pi.dispatch("tool_result", { type: "tool_result", toolName: "read", input: { path: "b" }, content: "ok", isError: false }, other)
    await entry
    expect(h.fetchBodies).toHaveLength(1)
    expect(JSON.stringify(h.fetchBodies[0]?.["state"])).not.toContain("make")
  })

  it("#given a gate call in flight #when the session shuts down #then the request is aborted and nothing is recorded", async () => {
    const h = setup({ advisor: { enabled: true, min_calls: 1 }, key: "k", hangFetch: true })
    await toolResults(h.pi, 1)
    await h.pi.dispatch("session_shutdown", { type: "session_shutdown" }, SESSION)
    expect(await h.lastFetchSignalAborted()).toBe(true)
    expect(h.entries).toHaveLength(0)
    expect(h.childRequests).toHaveLength(0)
  })

  it("#given sendMessage rejects #when the advice is delivered #then the failure is logged and no rejection escapes", async () => {
    const h = setup({ advisor: { enabled: true, min_calls: 1 }, key: "k" })
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => unhandled.push(reason)
    process.on("unhandledRejection", onUnhandled)
    try {
      Object.assign(h.pi, { sendMessage: () => Promise.reject(new Error("context retired")) })
      const held = h.nextEntry()
      await toolResults(h.pi, 1)
      await held
      const failed = h.nextWarning("delivery failed")
      await toolResults(h.pi, 1)
      expect(await failed).toContain("delivery failed")
      expect(unhandled).toEqual([])
    } finally {
      process.off("unhandledRejection", onUnhandled)
    }
  })
})
