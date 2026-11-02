import { describe, expect, test } from "bun:test"

import type { RunnerOutcome } from "../in-process/child-handle"
import { event, fakeSessionPort, handleOverPort } from "./handle.test-support"

const ABORTED_BY_STREAM_RULE = {
  role: "assistant",
  content: [{ type: "text", text: "partial [output interrupted by stream rule]" }],
  stopReason: "aborted",
  errorMessage: "This operation was aborted",
}

const CONTINUED = { role: "assistant", content: [{ type: "text", text: "finished after the nudge" }], stopReason: "stop" }

function settledYet(outcome: Promise<RunnerOutcome>): Promise<boolean> {
  return Promise.race([outcome.then(() => true), Promise.resolve().then(() => false)])
}

describe("host session turn settlement follows the session, not the first agent_end (omo#9069)", () => {
  test("#given a run a stream rule aborted #when the rule's nudge continues the same session #then the outcome is the continuation's result, not the abort", async () => {
    // given
    const port = fakeSessionPort()
    const handle = handleOverPort(port)
    await handle.startInitialPrompt("work")
    const outcome = handle.waitForOutcome()

    // when
    port.emitEvent(event({ type: "message_end", message: ABORTED_BY_STREAM_RULE }))
    port.emitEvent(event({ type: "agent_end", willRetry: false, aborted: true, abortSource: "system", messages: [ABORTED_BY_STREAM_RULE] }))
    port.emitEvent(event({ type: "agent_settled" }))
    const settledAfterAbort = await settledYet(outcome)
    port.emitEvent(event({ type: "agent_start" }))
    port.emitEvent(event({ type: "message_end", message: CONTINUED }))
    port.emitEvent(event({ type: "agent_end", willRetry: false, messages: [CONTINUED] }))
    port.emitEvent(event({ type: "agent_settled" }))
    port.emitEvent(event({ type: "agent_idle" }))

    // then
    expect(settledAfterAbort).toBe(false)
    expect(await outcome).toEqual({ status: "completed", finalResponse: "finished after the nudge" })
    await handle.dispose()
  })

  test("#given a settled turn #when the child starts a run on its own #then the handle reports the resume and the next outcome is that run's", async () => {
    // given
    const port = fakeSessionPort()
    const handle = handleOverPort(port)
    await handle.startInitialPrompt("work")
    port.emitEvent(event({ type: "message_end", message: CONTINUED }))
    port.emitEvent(event({ type: "agent_end", willRetry: false, messages: [CONTINUED] }))
    port.emitEvent(event({ type: "agent_idle" }))
    await handle.waitForOutcome()
    let resumes = 0
    handle.onSelfResumed(() => {
      resumes += 1
    })

    // when
    const woken = { role: "assistant", content: [{ type: "text", text: "the monitor fired, all green" }], stopReason: "stop" }
    port.emitEvent(event({ type: "agent_start" }))
    const next = handle.waitForOutcome()
    port.emitEvent(event({ type: "message_end", message: woken }))
    port.emitEvent(event({ type: "agent_end", willRetry: false, messages: [woken] }))
    port.emitEvent(event({ type: "agent_idle" }))

    // then
    expect(resumes).toBe(1)
    expect(await next).toEqual({ status: "completed", finalResponse: "the monitor fired, all green" })
    await handle.dispose()
  })

  test("#given a run that ends with no continuation #when the session goes idle #then the run's own outcome settles", async () => {
    // given
    const port = fakeSessionPort()
    const handle = handleOverPort(port)
    await handle.startInitialPrompt("work")
    const outcome = handle.waitForOutcome()

    // when
    port.emitEvent(event({ type: "message_end", message: ABORTED_BY_STREAM_RULE }))
    port.emitEvent(event({ type: "agent_end", willRetry: false, aborted: true, abortSource: "system", messages: [ABORTED_BY_STREAM_RULE] }))
    port.emitEvent(event({ type: "agent_idle" }))

    // then
    const settled = await outcome
    expect(settled.status).toBe("error")
    await handle.dispose()
  })
})

describe("a reopened session's finished transcript settles only an idle session (omo#9069)", () => {
  test("#given a finished-looking transcript #when the reopened session still has a follow-up queued #then the turn is not settled from the transcript", async () => {
    // given
    const port = fakeSessionPort()
    const handle = handleOverPort(port)
    const outcome = handle.waitForOutcome()
    void port.stateAsked().then(() =>
      port.answerState({ sessionId: "s", isStreaming: false, followUp: ["the monitor fired"], pendingMessageCount: 1 }),
    )

    // when
    await handle.adoptFinishedTurn("waiting for the test run")

    // then
    expect(await settledYet(outcome)).toBe(false)
    await handle.dispose()
  })

  test("#given a finished transcript #when the reopened session is idle #then the turn settles with the transcript's final answer", async () => {
    // given
    const port = fakeSessionPort()
    const handle = handleOverPort(port)
    const outcome = handle.waitForOutcome()
    void port.stateAsked().then(() =>
      port.answerState({ sessionId: "s", isStreaming: false, steering: [], followUp: [], pendingMessageCount: 0 }),
    )

    // when
    await handle.adoptFinishedTurn("all green")

    // then
    expect(await outcome).toEqual({ status: "completed", finalResponse: "all green" })
    await handle.dispose()
  })
  test("#given a finished transcript #when the reopened session's state read fails #then the turn stays unsettled and the handle survives", async () => {
    // given
    const port = { ...fakeSessionPort(), getState: () => Promise.reject(new Error("get_state timed out")) }
    const handle = handleOverPort(port)
    const outcome = handle.waitForOutcome()

    // when
    await handle.adoptFinishedTurn("all green")

    // then
    expect(await settledYet(outcome)).toBe(false)
    expect(handle.hasExited()).toBe(false)
    await handle.dispose()
  })
})
