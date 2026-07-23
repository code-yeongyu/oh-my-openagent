import { describe, expect, it } from "bun:test"
import { observeEventForWatchdog, type FirstPromptWatchdog } from "./first-prompt-watchdog"

interface RecordedWatchdogCalls {
  user: Array<{ sessionID: string; model?: string; agent?: string }>
  progress: string[]
  terminal: string[]
}

function createRecordingWatchdog(calls: RecordedWatchdogCalls): FirstPromptWatchdog {
  return {
    onUserMessage(sessionID, model, agent) {
      calls.user.push({ sessionID, model, agent })
    },
    onAssistantProgress(sessionID) {
      calls.progress.push(sessionID)
    },
    onSessionTerminal(sessionID) {
      calls.terminal.push(sessionID)
    },
    resolveDeferredTerminal: () => undefined,
    dispose() {},
  }
}

describe("observeEventForWatchdog", () => {
  const sessionID = "session-observed"

  function freshCalls(): RecordedWatchdogCalls {
    return { user: [], progress: [], terminal: [] }
  }

  it("#given a message.updated event with role=user #when observed #then onUserMessage is called with sessionID/model/agent", () => {
    const calls = freshCalls()
    observeEventForWatchdog(
      {
        type: "message.updated",
        properties: { info: { sessionID, role: "user", model: "openai/gpt-5.4-mini", agent: "sisyphus-junior" } },
      },
      createRecordingWatchdog(calls),
    )
    expect(calls.user).toEqual([{ sessionID, model: "openai/gpt-5.4-mini", agent: "sisyphus-junior" }])
    expect(calls.progress).toEqual([])
    expect(calls.terminal).toEqual([])
  })

  it("#given a compaction-agent message.updated event with role=user #when observed #then the watchdog does not arm", () => {
    const calls = freshCalls()
    observeEventForWatchdog(
      {
        type: "message.updated",
        properties: { info: { sessionID, role: "user", model: "openai/gpt-5.4-mini", agent: "compaction" } },
      },
      createRecordingWatchdog(calls),
    )
    expect(calls.user).toEqual([])
    expect(calls.progress).toEqual([])
    expect(calls.terminal).toEqual([])
  })

  it("#given a compaction-part user event retaining the original agent #when observed #then the watchdog does not arm", () => {
    const calls = freshCalls()
    observeEventForWatchdog(
      {
        type: "message.updated",
        properties: {
          info: { sessionID, role: "user", model: "openai/gpt-5.4-mini", agent: "sisyphus" },
          parts: [{ type: "compaction" }],
        },
      },
      createRecordingWatchdog(calls),
    )
    expect(calls.user).toEqual([])
    expect(calls.progress).toEqual([])
    expect(calls.terminal).toEqual([])
  })

  it("#given empty event parts mask an info compaction marker #when observed #then the watchdog does not arm", () => {
    const calls = freshCalls()
    observeEventForWatchdog(
      {
        type: "message.updated",
        properties: {
          info: {
            sessionID,
            role: "user",
            model: "openai/gpt-5.4-mini",
            agent: "sisyphus",
            parts: [{ type: "compaction" }],
          },
          parts: [],
        },
      },
      createRecordingWatchdog(calls),
    )
    expect(calls.user).toEqual([])
    expect(calls.progress).toEqual([])
    expect(calls.terminal).toEqual([])
  })

  const assistantProgressParts: ReadonlyArray<readonly [string, { readonly type: string; readonly text?: string; readonly id?: string; readonly name?: string; readonly tool_use_id?: string }]> = [
    ["text", { type: "text", text: "hello" }],
    ["reasoning", { type: "reasoning", text: "thinking..." }],
    ["tool", { type: "tool" }],
    ["tool_use", { type: "tool_use", id: "t1", name: "Read" }],
    ["tool_result", { type: "tool_result", tool_use_id: "t1" }],
    ["tool-call", { type: "tool-call" }],
    ["step-start", { type: "step-start" }],
    ["file", { type: "file" }],
  ]

  it.each(assistantProgressParts)("#given a message.updated assistant event whose only part is type=%s #when observed #then onAssistantProgress is called (model is *working*, not silent)", (_label: string, part: { readonly type: string; readonly text?: string; readonly id?: string; readonly name?: string; readonly tool_use_id?: string }) => {
    const calls = freshCalls()
    observeEventForWatchdog(
      {
        type: "message.updated",
        properties: { info: { sessionID, role: "assistant" }, parts: [part] },
      },
      createRecordingWatchdog(calls),
    )
    expect(calls.progress).toEqual([sessionID])
  })

  it.each(assistantProgressParts)("#given a message.part.updated event whose part is type=%s #when observed #then onAssistantProgress is called", (_label: string, part: { readonly type: string; readonly text?: string; readonly id?: string; readonly name?: string; readonly tool_use_id?: string }) => {
    const calls = freshCalls()
    observeEventForWatchdog(
      {
        type: "message.part.updated",
        properties: { sessionID, part },
      },
      createRecordingWatchdog(calls),
    )
    expect(calls.progress).toEqual([sessionID])
  })

  it("#given a message.updated assistant event with parts: [] and no error/finish #when observed #then no progress is signalled (no activity yet)", () => {
    const calls = freshCalls()
    observeEventForWatchdog(
      {
        type: "message.updated",
        properties: { info: { sessionID, role: "assistant" }, parts: [] },
      },
      createRecordingWatchdog(calls),
    )
    expect(calls.progress).toEqual([])
  })

  it("#given a message.updated assistant event with info.error set #when observed #then onAssistantProgress is called (the existing error-handling path takes over from here)", () => {
    const calls = freshCalls()
    observeEventForWatchdog(
      {
        type: "message.updated",
        properties: { info: { sessionID, role: "assistant", error: { name: "RateLimitError", message: "429" } } },
      },
      createRecordingWatchdog(calls),
    )
    expect(calls.progress).toEqual([sessionID])
  })

  it("#given a message.updated assistant event with info.finish set #when observed #then onAssistantProgress is called", () => {
    const calls = freshCalls()
    observeEventForWatchdog(
      {
        type: "message.updated",
        properties: { info: { sessionID, role: "assistant", finish: "stop" } },
      },
      createRecordingWatchdog(calls),
    )
    expect(calls.progress).toEqual([sessionID])
  })

  const terminalEventTypes: ReadonlyArray<readonly [string]> = [["session.idle"], ["session.stop"], ["session.deleted"], ["session.error"]]

  it.each(terminalEventTypes)(
    "#given a %s event #when observed #then onSessionTerminal is called",
    (eventType: string) => {
      const calls = freshCalls()
      observeEventForWatchdog(
        { type: eventType, properties: { sessionID } },
        createRecordingWatchdog(calls),
      )
      expect(calls.terminal).toEqual([sessionID])
    },
  )

  it("#given a session.deleted event whose sessionID is carried under properties.info.id #when observed #then onSessionTerminal is still called (matches event-handler shape)", () => {
    const calls = freshCalls()
    observeEventForWatchdog(
      { type: "session.deleted", properties: { info: { id: sessionID } } },
      createRecordingWatchdog(calls),
    )
    expect(calls.terminal).toEqual([sessionID])
  })

  it("#given an unrelated event type #when observed #then no watchdog method is called", () => {
    const calls = freshCalls()
    observeEventForWatchdog(
      { type: "session.created", properties: { info: { id: sessionID } } },
      createRecordingWatchdog(calls),
    )
    expect(calls.user).toEqual([])
    expect(calls.progress).toEqual([])
    expect(calls.terminal).toEqual([])
  })
})
