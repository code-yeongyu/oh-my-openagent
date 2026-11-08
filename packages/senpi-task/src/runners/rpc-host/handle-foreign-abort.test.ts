import { afterEach, describe, expect, test } from "bun:test"

import { childOpenInput, sessionClientHarness } from "./session-client.test-support"
import { createHostSessionHandle } from "./handle"
import { event, fakeSessionPort, handleOverPort } from "./handle.test-support"

// F10a: another client attached to the same child session aborts the child's turn. The host ends
// the run with agent_end { aborted: true, abortSource: "user" } - a user act, just not THIS
// parent's. That is an interruption (resumable, partial text kept), never a failure. A provider or
// system abort, and an abort with no source, keep today's error classification.

const PARTIAL_ANSWER = {
  role: "assistant",
  content: [{ type: "text", text: "partial answer before the foreign abort" }],
  stopReason: "aborted",
  errorMessage: "This operation was aborted",
}

const harness = sessionClientHarness()

afterEach(harness.release)

describe("host session foreign user abort classification (F10a)", () => {
  test("#given a running turn another client's user abort ends #when the terminating agent_end arrives #then the outcome is interrupted with the partial text", async () => {
    // given
    const port = fakeSessionPort()
    const handle = handleOverPort(port)
    await handle.startInitialPrompt("work")

    // when
    port.emitEvent(event({ type: "message_end", message: PARTIAL_ANSWER }))
    port.emitEvent(event({
      type: "agent_end",
      willRetry: false,
      aborted: true,
      abortSource: "user",
      abortedBy: "guest-client",
      messages: [PARTIAL_ANSWER],
    }))
    port.emitEvent(event({ type: "agent_idle" }))

    // then
    expect(await handle.waitForOutcome()).toEqual({
      status: "interrupted",
      finalResponse: "partial answer before the foreign abort",
      abortedBy: "guest-client",
    })
    await handle.dispose()
  })

  test("#given a turn this parent aborts first #when the host echoes the same user abortSource #then the outcome stays cancelled", async () => {
    // given
    const port = fakeSessionPort()
    const handle = handleOverPort(port)
    await handle.startInitialPrompt("work")

    // when
    await handle.abort()
    port.emitEvent(event({
      type: "agent_end",
      willRetry: false,
      aborted: true,
      abortSource: "user",
      messages: [PARTIAL_ANSWER],
    }))
    port.emitEvent(event({ type: "agent_idle" }))

    // then
    expect(await handle.waitForOutcome()).toEqual({ status: "cancelled" })
    await handle.dispose()
  })

  test("#given a provider abort #when the terminating agent_end arrives #then the outcome stays a turn failure", async () => {
    // given
    const port = fakeSessionPort()
    const handle = handleOverPort(port)
    await handle.startInitialPrompt("work")

    // when
    port.emitEvent(event({ type: "message_end", message: PARTIAL_ANSWER }))
    port.emitEvent(event({
      type: "agent_end",
      willRetry: false,
      aborted: true,
      abortSource: "provider",
      messages: [PARTIAL_ANSWER],
    }))
    port.emitEvent(event({ type: "agent_idle" }))

    // then
    const outcome = await handle.waitForOutcome()
    expect(outcome.status).toBe("error")
    expect(outcome.status === "error" ? outcome.failure.kind : undefined).toBe("child-turn-failed")
    await handle.dispose()
  })

  test("#given an abort the host does not attribute #when the terminating agent_end arrives #then the outcome keeps today's error classification", async () => {
    // given
    const port = fakeSessionPort()
    const handle = handleOverPort(port)
    await handle.startInitialPrompt("work")

    // when
    port.emitEvent(event({ type: "agent_end", willRetry: false, aborted: true, messages: [] }))
    port.emitEvent(event({ type: "agent_idle" }))

    // then
    expect((await handle.waitForOutcome()).status).toBe("error")
    await handle.dispose()
  })
})

describe("a foreign user abort read off the real wire (F10a)", () => {
  test("#given a live daemon session #when the abort record travels the socket #then the session reader delivers abortSource and the outcome is interrupted", async () => {
    // given
    const host = await harness.fakeHost()
    const client = harness.hostClient(host)
    const sessionPath = "/tmp/f10a-foreign-abort-child.jsonl"
    const opened = await client.open(childOpenInput(sessionPath))
    const handle = createHostSessionHandle({
      client,
      session: { routingId: opened.sessionId, sessionPath, instanceId: opened.instanceId },
      taskId: "st_f10a_wire",
      heartbeatIntervalMs: 60_000,
      now: () => 11,
      closeGraceMs: 100,
      openDisposition: opened.attached ? "attached" : "reopened",
    })

    // when
    const outcome = handle.waitForOutcome()
    host.emitRecord(opened.sessionId, { type: "message_end", message: PARTIAL_ANSWER })
    host.emitRecord(opened.sessionId, {
      type: "agent_end",
      willRetry: false,
      aborted: true,
      abortSource: "user",
      messages: [PARTIAL_ANSWER],
    })
    host.emitRecord(opened.sessionId, { type: "agent_idle" })

    // then
    expect(await outcome).toEqual({ status: "interrupted", finalResponse: "partial answer before the foreign abort" })
    await handle.dispose()
  })
})
