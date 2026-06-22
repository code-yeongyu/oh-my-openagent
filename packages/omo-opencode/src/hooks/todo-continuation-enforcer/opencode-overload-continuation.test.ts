/// <reference types="bun-types" />

import type { PluginInput } from "@opencode-ai/plugin"
import { createOpencodeClient } from "@opencode-ai/sdk"
import { describe, expect, test } from "bun:test"

import { _resetForTesting, setMainSession } from "../../features/claude-code-session-state"
import { createTodoContinuationEnforcer } from "."

type PromptCall = {
  sessionID: string
  text: string
}

type PromptInput = {
  path: { id: string }
  body: { parts: Array<{ text: string }> }
}

type TimerCallback = (...args: unknown[]) => void
type FakeTimerID = number & ReturnType<typeof setTimeout> & ReturnType<typeof setInterval>

function createPluginInput(promptCalls: PromptCall[]): PluginInput {
  const directory = "/tmp/opencode-overload-continuation-test"
  const client = createOpencodeClient({ directory })
  Reflect.set(client.session, "todo", async () => ({
    data: [
      { id: "1", content: "Keep working", status: "pending", priority: "high" },
    ],
  }))
  Reflect.set(client.session, "messages", async () => ({ data: [] }))
  Reflect.set(client.session, "promptAsync", async (input: PromptInput) => {
    promptCalls.push({
      sessionID: input.path.id,
      text: input.body.parts[0]?.text ?? "",
    })
    return {}
  })
  Reflect.set(client.tui, "showToast", async () => ({}))

  return {
    client,
    project: {
      id: "opencode-overload-continuation-test",
      worktree: directory,
      time: { created: Date.now() },
    },
    directory,
    worktree: directory,
    experimental_workspace: { register: () => {} },
    serverUrl: new URL("http://localhost"),
    $: {} as PluginInput["$"],
  }
}

describe("todo-continuation-enforcer OpenCode overload errors", () => {
  test(
    "#given countdown is armed #when OpenCode reports server_is_overloaded #then continuation still injects",
    async () => {
      // given
      const sessionID = "main-opencode-overload"
      const promptCalls: PromptCall[] = []
      _resetForTesting()
      setMainSession(sessionID)
      const hook = createTodoContinuationEnforcer(createPluginInput(promptCalls))
      const original = {
        setTimeout: globalThis.setTimeout,
        clearTimeout: globalThis.clearTimeout,
        setInterval: globalThis.setInterval,
        clearInterval: globalThis.clearInterval,
      }
      const scheduledTimeouts: Array<{ delay: number; callback: TimerCallback; args: unknown[] }> = []
      const fakeSetTimeout = (handler: TimerHandler, delay?: number, ...callbackArgs: unknown[]) => {
        if (typeof handler !== "function") {
          return original.setTimeout(handler, delay, ...callbackArgs)
        }
        const callback: TimerCallback = (...timerArgs) => {
          handler(...timerArgs)
        }
        scheduledTimeouts.push({
          delay: typeof delay === "number" && Number.isFinite(delay) ? delay : 0,
          callback,
          args: callbackArgs,
        })
        return scheduledTimeouts.length as FakeTimerID
      }
      Reflect.set(globalThis, "setTimeout", fakeSetTimeout)
      Reflect.set(globalThis, "clearTimeout", () => {})
      Reflect.set(globalThis, "setInterval", () => (scheduledTimeouts.length + 1) as FakeTimerID)
      Reflect.set(globalThis, "clearInterval", () => {})

      try {
        await hook.handler({
          event: { type: "session.idle", properties: { sessionID } },
        })

        // when
        await hook.handler({
          event: {
            type: "session.error",
            properties: {
              sessionID,
              error: {
                type: "error",
                sequence_number: 2,
                error: {
                  type: "service_unavailable_error",
                  code: "server_is_overloaded",
                  message: "Our servers are currently overloaded. Please try again later.",
                  param: null,
                },
              },
            },
          },
        })
        const countdownTimer = scheduledTimeouts.find((timer) => timer.delay === 2000)
        expect(countdownTimer).toBeDefined()
        countdownTimer?.callback(...countdownTimer.args)
        for (let index = 0; index < 25; index++) {
          await Promise.resolve()
        }

        // then
        expect(promptCalls).toHaveLength(1)
        expect(promptCalls[0]?.sessionID).toBe(sessionID)
        expect(promptCalls[0]?.text).toContain("TODO CONTINUATION")
      } finally {
        Reflect.set(globalThis, "setTimeout", original.setTimeout)
        Reflect.set(globalThis, "clearTimeout", original.clearTimeout)
        Reflect.set(globalThis, "setInterval", original.setInterval)
        Reflect.set(globalThis, "clearInterval", original.clearInterval)
        _resetForTesting()
      }
    },
    { timeout: 10000 },
  )
})
