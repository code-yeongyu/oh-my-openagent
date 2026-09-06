import { describe, expect, test } from "bun:test"

import { createChildHandle, type ChildSession, type ChildSessionEvent, type ChildSessionListener } from "./child-handle"

type EmittingSessionControls = {
  readonly session: ChildSession
  readonly lastText: { value: string | undefined }
  emit(event: ChildSessionEvent): void
  resolvePrompt(): void
}

// Controllable ChildSession that also emits subscribed events, so turn outcomes can be driven the
// way a real senpi AgentSession drives them: message_end events first, then prompt() resolution.
function createEmittingSession(sessionId = "child-session-1"): EmittingSessionControls {
  const listeners = new Set<ChildSessionListener>()
  const lastText = { value: undefined as string | undefined }
  let settle: (() => void) | undefined
  const session: ChildSession = {
    sessionId,
    prompt() {
      return new Promise<void>((resolve) => {
        settle = resolve
      })
    },
    async steer() {},
    async followUp() {},
    async abort() {},
    subscribe(listener: ChildSessionListener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getLastAssistantText() {
      return lastText.value
    },
    dispose() {},
  }
  return {
    session,
    lastText,
    emit: (event) => {
      for (const listener of listeners) listener(event)
    },
    resolvePrompt: () => settle?.(),
  }
}

function assistantEnd(text: string, stopReason: string, errorMessage?: string): ChildSessionEvent {
  return {
    type: "message_end",
    message: {
      role: "assistant",
      content: text.length > 0 ? [{ type: "text", text }] : [],
      stopReason,
      ...(errorMessage === undefined ? {} : { errorMessage }),
    },
  } as ChildSessionEvent
}

function toolUseEnd(): ChildSessionEvent {
  return {
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "toolCall", id: "c1", name: "nudge", arguments: {} }],
      stopReason: "toolUse",
    },
  }
}

function emptyTextEnd(): ChildSessionEvent {
  return {
    type: "message_end",
    message: { role: "assistant", content: [{ type: "text", text: "" }], stopReason: "stop" },
  }
}

describe("createChildHandle turn outcomes", () => {
  test('#given completion "turn" and a toolUse message_end followed by a stop message_end with an empty text part #when the prompt resolves #then the outcome is completed with empty finalResponse', async () => {
    const fake = createEmittingSession()
    const handle = createChildHandle({ taskId: "task-1", session: fake.session, promptText: "judge", completion: "turn" })

    fake.emit(toolUseEnd())
    fake.emit(emptyTextEnd())
    fake.resolvePrompt()

    expect(await handle.waitForIdle()).toEqual({ status: "completed", finalResponse: "" })
  })

  test('#given completion "turn" and a stop message_end with no assistant text and no baseline change #when the prompt resolves #then the outcome is completed, not the no-output error', async () => {
    const fake = createEmittingSession()
    fake.lastText.value = "previous verdict"
    const handle = createChildHandle({ taskId: "task-1", session: fake.session, promptText: "judge", completion: "turn" })

    fake.emit(assistantEnd("", "stop"))
    fake.resolvePrompt()

    expect(await handle.waitForIdle()).toEqual({ status: "completed", finalResponse: "" })
  })

  test('#given completion "turn" and a stopReason error message_end #when the prompt resolves #then the outcome is still an error carrying the provider message', async () => {
    const fake = createEmittingSession()
    const handle = createChildHandle({ taskId: "task-1", session: fake.session, promptText: "judge", completion: "turn" })
    fake.emit(assistantEnd("", "error", "upstream gateway timeout"))
    fake.resolvePrompt()
    expect(await handle.waitForIdle()).toEqual({
      status: "error",
      failure: { kind: "child-turn-failed", message: "upstream gateway timeout" },
    })

    // A normally settled retry retains the policy without inheriting the provider failure.
    await handle.followUp("retry the judgement")
    fake.emit(emptyTextEnd())
    fake.resolvePrompt()
    expect(await handle.waitForIdle()).toEqual({ status: "completed", finalResponse: "" })
  })

  test('#given completion "turn" and an abort after prompt resolution #when waitForIdle settles #then the outcome is cancelled', async () => {
    const fake = createEmittingSession()
    const handle = createChildHandle({ taskId: "task-1", session: fake.session, promptText: "judge", completion: "turn" })
    const outcome = handle.waitForIdle()
    fake.emit(emptyTextEnd())
    fake.resolvePrompt()
    // abort marks the handle synchronously before runTurn's continuation can settle.
    await handle.abort()
    expect(await outcome).toEqual({ status: "cancelled" })

    // Revival resets cancellation but retains the caller's completion policy.
    await handle.followUp("judge again")
    fake.emit(emptyTextEnd())
    fake.resolvePrompt()
    expect(await handle.waitForIdle()).toEqual({ status: "completed", finalResponse: "" })
  })

  test('#given completion "turn" and a length stopReason after tool-stage text #when the prompt resolves #then the outcome completes with that text', async () => {
    const fake = createEmittingSession()
    const handle = createChildHandle({ taskId: "task-1", session: fake.session, promptText: "judge", completion: "turn" })
    fake.emit(assistantEnd("tool-stage verdict", "toolUse"))
    fake.emit(assistantEnd("", "length"))
    fake.lastText.value = "tool-stage verdict"
    fake.resolvePrompt()
    expect(await handle.waitForIdle()).toEqual({ status: "completed", finalResponse: "tool-stage verdict" })

    // The next silent turn completes without borrowing the earlier tool-stage text.
    await handle.followUp("judge again")
    fake.emit(emptyTextEnd())
    fake.resolvePrompt()
    expect(await handle.waitForIdle()).toEqual({ status: "completed", finalResponse: "" })
  })

  test("#given a turn ending with a stopReason error message #when the prompt resolves #then the outcome is an error carrying the provider message", async () => {
    // given a child whose provider request failed; senpi surfaces this as an event, prompt() resolves cleanly
    const fake = createEmittingSession()
    const handle = createChildHandle({ taskId: "task-1", session: fake.session, promptText: "review this" })

    // when the failed turn settles
    fake.emit(assistantEnd("", "error", "upstream gateway timeout"))
    fake.resolvePrompt()
    const outcome = await handle.waitForIdle()

    // then the failure is NOT recorded as a silent empty completion
    expect(outcome.status).toBe("error")
    if (outcome.status !== "error") throw new Error("expected error outcome")
    expect(outcome.failure.message).toContain("upstream gateway timeout")
  })

  test("#given a turn that produces no assistant output at all #when the prompt resolves #then the outcome is an error, never completed with empty text", async () => {
    // given a child that hung and settled without a single assistant message
    const fake = createEmittingSession()
    const handle = createChildHandle({ taskId: "task-1", session: fake.session, promptText: "review this" })

    // when the silent turn settles
    fake.resolvePrompt()
    const outcome = await handle.waitForIdle()

    // then
    expect(outcome.status).toBe("error")
    if (outcome.status !== "error") throw new Error("expected error outcome")
    expect(outcome.failure.message).toContain("no assistant output")
  })

  test("#given a revived child whose new turn produces nothing #when the revive turn resolves #then the stale previous response is NOT reused as a fresh completion", async () => {
    // given a first turn that completed with real output
    const fake = createEmittingSession()
    const handle = createChildHandle({ taskId: "task-1", session: fake.session, promptText: "first run" })
    fake.emit(assistantEnd("first verdict", "stop"))
    fake.lastText.value = "first verdict"
    fake.resolvePrompt()
    expect(await handle.waitForIdle()).toEqual({ status: "completed", finalResponse: "first verdict" })

    // when a revive turn produces no new output
    await handle.followUp("re-emit your verdict")
    fake.resolvePrompt()
    const outcome = await handle.waitForIdle()

    // then the previous run's text must not masquerade as the revive result
    expect(outcome.status).toBe("error")
  })

  test("#given a healthy turn with assistant text #when the prompt resolves #then the outcome completes with this turn's text", async () => {
    // given
    const fake = createEmittingSession()
    const handle = createChildHandle({ taskId: "task-1", session: fake.session, promptText: "do the work" })

    // when
    fake.emit(assistantEnd("all done", "stop"))
    fake.resolvePrompt()

    // then
    expect(await handle.waitForIdle()).toEqual({ status: "completed", finalResponse: "all done" })
  })
})
