import { describe, expect, test } from "bun:test"

import type { HostSessionCommand } from "./session-client"
import { event, fakeSessionPort, handleOverPort } from "./handle.test-support"

// The exact rejection senpi's AgentSession.prompt() raises when a message lands on a streaming
// session without queueing semantics - identical on the daemon path, where the session is shared
// with nothing but this child yet still refuses an un-flagged mid-run delivery.
const BUSY_CHILD_REJECTION =
  "Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message."

function busyOn(type: HostSessionCommand["type"]): (command: HostSessionCommand) => Promise<void> {
  return (command) =>
    command.type === type ? Promise.reject(new Error(BUSY_CHILD_REJECTION)) : Promise.resolve()
}

function prompts(sent: readonly HostSessionCommand[]): readonly HostSessionCommand[] {
  return sent.filter((command) => command.type === "prompt")
}

function promptBehaviors(sent: readonly HostSessionCommand[]): ReadonlyArray<string | undefined> {
  return sent.flatMap((command) => (command.type === "prompt" ? [command.streamingBehavior] : []))
}

describe("host session delivery semantics", () => {
  test("#given a session that accepts the turn #when the initial prompt is delivered #then it declares steer semantics", async () => {
    // given
    const port = fakeSessionPort()
    const handle = handleOverPort(port)

    // when
    await handle.startInitialPrompt("do the daemon child work")

    // then
    expect(prompts(port.sent)).toEqual([
      { type: "prompt", message: "do the daemon child work", streamingBehavior: "steer" },
    ])
    await handle.dispose()
  })

  test("#given a host that refuses steer as busy #when task_send steers #then the delivery degrades to followUp", async () => {
    // given
    const port = fakeSessionPort(busyOn("steer"))
    const handle = handleOverPort(port)

    // when
    await handle.steer("keep going")

    // then
    expect(prompts(port.sent)).toEqual([{ type: "prompt", message: "keep going", streamingBehavior: "followUp" }])
    await handle.dispose()
  })

  test("#given a host that refuses a steer-flavored prompt #when the initial prompt is delivered #then it is retried as followUp", async () => {
    // given
    const port = fakeSessionPort((command) =>
      command.type === "prompt" && command.streamingBehavior === "steer"
        ? Promise.reject(new Error(BUSY_CHILD_REJECTION))
        : Promise.resolve(),
    )
    const handle = handleOverPort(port)

    // when
    await handle.startInitialPrompt("do the daemon child work")

    // then
    expect(promptBehaviors(port.sent)).toEqual(["steer", "followUp"])
    await handle.dispose()
  })

  test("#given a host that fails the delivery for a real reason #when the prompt is delivered #then the failure surfaces as the turn outcome", async () => {
    // given
    const port = fakeSessionPort(() => Promise.reject(new Error("session_detached")))
    const handle = handleOverPort(port)

    // when
    const rejection = await handle.startInitialPrompt("work").catch((error: unknown) => error)

    // then
    expect(rejection).toBeInstanceOf(Error)
    const outcome = await handle.waitForOutcome()
    expect(outcome.status).toBe("error")
    expect(outcome.status === "error" ? outcome.failure.kind : undefined).toBe("child-prompt-failed")
    await handle.dispose()
  })
})

describe("host session turn outcomes", () => {
  test("#given a turn the user aborted #when the terminating agent_end arrives #then the outcome is cancelled", async () => {
    // given
    const port = fakeSessionPort()
    const handle = handleOverPort(port)
    await handle.startInitialPrompt("work")

    // when
    await handle.abort()
    port.emitEvent(event({ type: "agent_end", willRetry: false, messages: [] }))
    port.emitEvent(event({ type: "agent_idle" }))

    // then
    expect((await handle.waitForOutcome()).status).toBe("cancelled")
    expect(handle.wasAbortedByUser()).toBe(true)
    expect(port.sent.at(-1)).toEqual({ type: "abort" })
    await handle.dispose()
  })

  test("#given a provider error with partial text #when the turn ends #then the terminal facts and last text are retained", async () => {
    // given
    const port = fakeSessionPort()
    const handle = handleOverPort(port)
    await handle.startInitialPrompt("work")

    // when
    port.emitEvent(
      event({
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "partial" }],
          stopReason: "error",
          errorMessage: "401 unauthorized; re-authenticate",
        },
      }),
    )
    port.emitEvent(event({ type: "agent_end", willRetry: false, messages: [] }))
    port.emitEvent(event({ type: "agent_idle" }))
    await handle.waitForIdle()

    // then
    expect(handle.terminalAssistantMessage()).toEqual({
      text: "partial",
      stopReason: "error",
      errorMessage: "401 unauthorized; re-authenticate",
    })
    expect(handle.lastAssistantText()).toBe("partial")
    expect(handle.wasAbortedByUser()).toBe(false)
    await handle.dispose()
  })

  test("#given a completed turn #when a follow-up revives the child #then terminal facts reset and the new turn settles on its own text", async () => {
    // given
    const port = fakeSessionPort()
    const handle = handleOverPort(port)
    await handle.startInitialPrompt("work")
    port.emitEvent(
      event({
        type: "message_end",
        message: { role: "assistant", content: [{ type: "text", text: "first" }], stopReason: "stop" },
      }),
    )
    port.emitEvent(event({ type: "agent_end", willRetry: false, messages: [] }))
    port.emitEvent(event({ type: "agent_idle" }))
    expect(await handle.waitForOutcome()).toEqual({ status: "completed", finalResponse: "first" })

    // when
    await handle.followUp("second")

    // then
    expect(handle.terminalAssistantMessage()).toBeUndefined()
    expect(handle.lastAssistantText()).toBe("first")
    port.emitEvent(
      event({
        type: "message_end",
        message: { role: "assistant", content: [{ type: "text", text: "second answer" }], stopReason: "stop" },
      }),
    )
    port.emitEvent(event({ type: "agent_end", willRetry: false, messages: [] }))
    port.emitEvent(event({ type: "agent_idle" }))
    expect(await handle.waitForOutcome()).toEqual({ status: "completed", finalResponse: "second answer" })
    await handle.dispose()
  })
})

describe("host session heartbeat", () => {
  test("#given a live session #when the heartbeat interval elapses #then it reads get_state and records lastSeen", async () => {
    // given
    const port = fakeSessionPort()
    const handle = handleOverPort(port, 1)
    expect(handle.lastSeen()).toBeUndefined()

    // when
    await port.stateAsked()
    await port.answerState({ sessionId: "durable-routing-1" })

    // then the durable session id and the liveness stamp both come from get_state
    expect(handle.lastSeen()).toBe(7)
    expect(handle.sessionId).toBe("durable-routing-1")
    expect(port.sent).toEqual([])
    await handle.dispose()
  })
})
