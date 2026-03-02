/// <reference types="bun-types" />

import { describe, expect, it, mock } from "bun:test"
import { renderMultipleInterrupts } from "../../features/ttsr/interrupt-template"
import type { TtsrRule, TtsrSettings } from "../../features/ttsr/types"
import { createAbortRetryHandler } from "./abort-retry-handler"

const settings: TtsrSettings = {
  enabled: true,
  contextMode: "discard",
  interruptMode: "always",
  repeatMode: "once",
  repeatGap: 0,
  maxRetriesPerRule: 3,
}

const createRule = (overrides: Partial<TtsrRule> = {}): TtsrRule => ({
  name: "test-rule",
  content: "Follow this rule",
  condition: ["test-pattern"],
  scope: ["text"],
  ...overrides,
})

const createHandler = () => {
  const callOrder: string[] = []
  const abort = mock(async (_sessionID: string) => {
    callOrder.push("abort")
  })
  const promptAsync = mock(async (_sessionID: string, _content: string) => {
    callOrder.push("prompt")
  })

  const handler = createAbortRetryHandler({ abort, promptAsync })

  return {
    handler,
    abort,
    promptAsync,
    callOrder,
  }
}

describe("createAbortRetryHandler", () => {
  describe("#given AbortRetryHandler", () => {
    describe("#when handleMatches is called with matched rules", () => {
      describe("#then abort is called before promptAsync with rendered content", () => {
        it("calls abort then promptAsync in order", async () => {
          const { handler, abort, promptAsync, callOrder } = createHandler()
          const matchedRules = [
            createRule({ name: "rule-a", content: "Do not use tool X" }),
            createRule({ name: "rule-b", content: "Use format Y", condition: ["format-y"] }),
          ]
          const expectedInterrupt = renderMultipleInterrupts(matchedRules)

          await handler.handleMatches("ses_123", matchedRules, settings)

          expect(callOrder).toEqual(["abort", "prompt"])
          expect(abort).toHaveBeenCalledTimes(1)
          expect(promptAsync).toHaveBeenCalledTimes(1)
          expect(abort.mock.calls[0]).toEqual(["ses_123"])
          expect(promptAsync.mock.calls[0]).toEqual(["ses_123", expectedInterrupt])
        })
      })
    })

    describe("#when handleMatches completes", () => {
      describe("#then getPendingInjection returns stored interrupt content", () => {
        it("returns the pending injection string for the session", async () => {
          const { handler } = createHandler()
          const matchedRules = [createRule()]
          const expectedInterrupt = renderMultipleInterrupts(matchedRules)

          await handler.handleMatches("ses_123", matchedRules, settings)

          expect(handler.getPendingInjection("ses_123")).toBe(expectedInterrupt)
        })
      })
    })

    describe("#when clearPendingInjection is called", () => {
      describe("#then stored pending content is removed", () => {
        it("clears pending injection for the session", async () => {
          const { handler } = createHandler()
          const matchedRules = [createRule()]

          await handler.handleMatches("ses_123", matchedRules, settings)
          handler.clearPendingInjection("ses_123")

          expect(handler.getPendingInjection("ses_123")).toBeUndefined()
        })
      })
    })

    describe("#when handleMatches is called with empty rules", () => {
      describe("#then abort and promptAsync are still called", () => {
        it("calls promptAsync with empty rendered content", async () => {
          const { handler, abort, promptAsync, callOrder } = createHandler()
          const expectedInterrupt = renderMultipleInterrupts([])

          await handler.handleMatches("ses_123", [], settings)

          expect(callOrder).toEqual(["abort", "prompt"])
          expect(abort).toHaveBeenCalledTimes(1)
          expect(promptAsync).toHaveBeenCalledTimes(1)
          expect(promptAsync.mock.calls[0]).toEqual(["ses_123", expectedInterrupt])
          expect(expectedInterrupt).toBe("")
        })
      })
    })
  })
})
