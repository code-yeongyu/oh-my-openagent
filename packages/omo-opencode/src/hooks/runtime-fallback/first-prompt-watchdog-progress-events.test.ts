/// <reference path="../../../../../bun-test.d.ts" />

import { describe, expect, it } from "bun:test"

import { observeEventForWatchdog, type FirstPromptWatchdog } from "./first-prompt-watchdog"

interface RecordedWatchdogCalls {
  readonly user: string[]
  readonly progress: string[]
  readonly terminal: string[]
}

function createRecordingWatchdog(calls: RecordedWatchdogCalls): FirstPromptWatchdog {
  return {
    onUserMessage(sessionID) {
      calls.user.push(sessionID)
    },
    onAssistantProgress(sessionID) {
      calls.progress.push(sessionID)
    },
    onSessionTerminal(sessionID) {
      calls.terminal.push(sessionID)
    },
    dispose() {},
  }
}

function freshCalls(): RecordedWatchdogCalls {
  return { user: [], progress: [], terminal: [] }
}

describe("observeEventForWatchdog progress markers", () => {
  const sessionID = "session-observed-progress"

  for (const [label, marker] of [
    ["finished boolean", { finished: true }],
    ["completed boolean", { completed: true }],
    ["completed time", { time: { completed: 1779267000000 } }],
  ] as const) {
    it(`#given a message.updated assistant event with ${label} #when observed #then onAssistantProgress is called`, () => {
      const calls = freshCalls()
      observeEventForWatchdog(
        {
          type: "message.updated",
          properties: { info: { sessionID, role: "assistant", ...marker } },
        },
        createRecordingWatchdog(calls),
      )
      expect(calls.progress).toEqual([sessionID])
    })
  }

  it("#given a message.updated assistant event with false completion markers and no parts #when observed #then no progress is signalled", () => {
    const calls = freshCalls()
    observeEventForWatchdog(
      {
        type: "message.updated",
        properties: {
          info: {
            sessionID,
            role: "assistant",
            completed: false,
            finish: false,
            finished: false,
          },
          parts: [],
        },
      },
      createRecordingWatchdog(calls),
    )
    expect(calls.progress).toEqual([])
  })

  for (const [eventType] of [
    ["session.next.text.delta"],
    ["session.next.reasoning.delta"],
    ["session.next.tool.called"],
    ["session.next.tool.success"],
    ["session.next.step.ended"],
  ] as const) {
    it(`#given a ${eventType} event with a sessionID #when observed #then onAssistantProgress is called`, () => {
      const calls = freshCalls()
      observeEventForWatchdog(
        { type: eventType, properties: { sessionID } },
        createRecordingWatchdog(calls),
      )
      expect(calls.progress).toEqual([sessionID])
    })
  }
})
