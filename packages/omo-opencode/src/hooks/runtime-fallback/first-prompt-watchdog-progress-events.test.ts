/// <reference path="../../../../../bun-test.d.ts" />

import { afterEach, describe, expect, it } from "bun:test"

import { setMainSession } from "../../features/claude-code-session-state"
import { createFirstPromptWatchdog, observeEventForWatchdog, type FirstPromptWatchdog } from "./first-prompt-watchdog"
import {
  AGENT,
  createDeps,
  createHelpers,
  installFakeTimers,
  PLUGIN_CONFIG_WITH_FALLBACK,
  PRIMARY_MODEL,
  type RecordedCalls,
  SAFE_WAIT_AFTER_FIRE_MS,
  WATCHDOG_MS,
} from "./first-prompt-watchdog-test-helpers"

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

  afterEach(() => {
    setMainSession(undefined)
  })

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

  for (const [eventType, properties] of [
    ["session.next.synthetic", { text: "synthetic output" }],
    ["session.next.shell.started", {}],
    ["session.next.shell.ended", {}],
    ["session.next.step.failed", {}],
    ["session.next.text.delta", { delta: "hello" }],
    ["session.next.text.ended", { text: "hello" }],
    ["session.next.reasoning.delta", { delta: "thinking" }],
    ["session.next.reasoning.ended", { text: "thinking" }],
    ["session.next.tool.input.started", {}],
    ["session.next.tool.input.delta", { delta: "{\"path\":" }],
    ["session.next.tool.input.ended", { text: "{\"path\":\"README.md\"}" }],
    ["session.next.tool.called", {}],
    ["session.next.tool.progress", {}],
    ["session.next.tool.success", {}],
    ["session.next.tool.failed", {}],
    ["session.next.step.ended", {}],
  ] as const) {
    it(`#given a ${eventType} event with a sessionID #when observed #then onAssistantProgress is called`, () => {
      const calls = freshCalls()
      observeEventForWatchdog(
        { type: eventType, properties: { sessionID, ...properties } },
        createRecordingWatchdog(calls),
      )
      expect(calls.progress).toEqual([sessionID])
    })
  }

  for (const [eventType, properties] of [
    ["session.next.prompted", {}],
    ["session.next.step.started", {}],
    ["session.next.text.started", {}],
    ["session.next.reasoning.started", {}],
    ["session.next.agent.switched", {}],
    ["session.next.model.switched", {}],
    ["session.next.text.delta", { delta: "" }],
    ["session.next.text.ended", { text: "" }],
    ["session.next.reasoning.delta", { delta: "" }],
    ["session.next.reasoning.ended", { text: "" }],
    ["session.next.tool.input.delta", { delta: "" }],
    ["session.next.tool.input.ended", { text: "" }],
    ["session.next.synthetic", { text: "" }],
    ["session.next.retried", {}],
    ["session.next.compaction.started", {}],
  ] as const) {
    it(`#given an armed watchdog #when ${eventType} arrives without assistant output #then silence recovery still fires`, async () => {
      const timers = installFakeTimers()
      const deps = createDeps(PLUGIN_CONFIG_WITH_FALLBACK)
      const calls: RecordedCalls = { abort: [], autoRetry: [] }
      const watchdog = createFirstPromptWatchdog(deps, createHelpers(calls, AGENT), WATCHDOG_MS)
      setMainSession(sessionID)

      try {
        watchdog.onUserMessage(sessionID, PRIMARY_MODEL, AGENT)
        observeEventForWatchdog({ type: eventType, properties: { sessionID, ...properties } }, watchdog)
        await timers.advanceBy(SAFE_WAIT_AFTER_FIRE_MS)

        expect(calls.abort).toEqual([
          { sessionID, source: "first-prompt-watchdog" },
        ])
        expect(calls.autoRetry).toEqual([
          {
            sessionID,
            newModel: "anthropic/claude-haiku-4-5",
            resolvedAgent: AGENT,
            source: "first-prompt-watchdog",
          },
        ])
      } finally {
        watchdog.dispose()
        timers.restore()
      }
    })
  }
})
