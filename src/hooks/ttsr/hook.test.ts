/// <reference types="bun-types" />

import { describe, expect, it, mock } from "bun:test"
import { createTtsrHook } from "./hook"
import type { TtsrRule, TtsrSettings } from "../../features/ttsr/types"

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
  content: "test rule",
  condition: ["test-pattern"],
  scope: [],
  ...overrides,
})

const createHook = (ruleOverrides: Partial<TtsrRule> = {}) => {
  const onMatch = mock((_sessionID: string, _matchedRules: TtsrRule[]) => Promise.resolve())
  const hook = createTtsrHook({
    settings,
    rules: [createRule(ruleOverrides)],
    onMatch,
  })
  return { hook, onMatch }
}

describe("createTtsrHook", () => {
  describe("#given TtsrHook with one rule", () => {
    describe("#when session.created event fires", () => {
      describe("#then manager is initialized", () => {
        it("returns initialized manager from getManager", async () => {
          const { hook } = createHook()
          await hook.handleEvent({ type: "session.created" }, { info: { id: "ses_123" } })
          expect(hook.getManager("ses_123")).toBeDefined()
        })
      })
    })

    describe("#when session.deleted event fires", () => {
      describe("#then manager is cleaned up", () => {
        it("removes initialized manager", async () => {
          const { hook } = createHook()
          await hook.handleEvent({ type: "session.created" }, { info: { id: "ses_123" } })
          await hook.handleEvent({ type: "session.deleted" }, { info: { id: "ses_123" } })
          expect(hook.getManager("ses_123")).toBeUndefined()
        })
      })
    })

    describe("#when message.updated event fires", () => {
      describe("#then manager.resetBuffer and manager.incrementMessageCount are called", () => {
        it("calls both manager methods exactly once", async () => {
          const { hook } = createHook()
          await hook.handleEvent({ type: "session.created" }, { info: { id: "ses_123" } })

          const manager = hook.getManager("ses_123")
          if (!manager) {
            throw new Error("Expected manager to be initialized")
          }

          const resetBuffer = mock(() => {})
          const incrementMessageCount = mock(() => {})
          manager.resetBuffer = resetBuffer
          manager.incrementMessageCount = incrementMessageCount

          await hook.handleEvent({ type: "message.updated" }, { info: { sessionID: "ses_123" } })

          expect(resetBuffer).toHaveBeenCalledTimes(1)
          expect(incrementMessageCount).toHaveBeenCalledTimes(1)
        })
      })
    })

    describe("#when assistant emits matching text in message.part.updated", () => {
      describe("#then onMatch is triggered with matched rule", () => {
        it("calls onMatch with sessionID and matched rules", async () => {
          const { hook, onMatch } = createHook()
          await hook.handleEvent({ type: "session.created" }, { info: { id: "ses_123" } })

          await hook.handleEvent(
            { type: "message.part.updated" },
            {
              info: {
                sessionID: "ses_123",
                role: "assistant",
                part: { id: "part_1", type: "text", text: "hello test-pattern world" },
              },
            }
          )

          expect(onMatch).toHaveBeenCalledTimes(1)
          const firstCall = onMatch.mock.calls[0]
          if (!firstCall) {
            throw new Error("Expected onMatch to be called")
          }
          const [sessionID, calledRules] = firstCall
          expect(sessionID).toBe("ses_123")
          expect(calledRules[0]?.name).toBe("test-rule")
        })
      })
    })

    describe("#when message.part.updated comes from non-assistant role", () => {
      describe("#then event is ignored", () => {
        it("does not call onMatch for user role", async () => {
          const { hook, onMatch } = createHook()
          await hook.handleEvent({ type: "session.created" }, { info: { id: "ses_123" } })

          await hook.handleEvent(
            { type: "message.part.updated" },
            {
              info: {
                sessionID: "ses_123",
                role: "user",
                part: { id: "part_1", type: "text", text: "test-pattern" },
              },
            }
          )

          expect(onMatch).not.toHaveBeenCalled()
        })
      })
    })

    describe("#when message.part.updated has non-text part", () => {
      describe("#then event is ignored", () => {
        it("does not call onMatch for tool-use part", async () => {
          const { hook, onMatch } = createHook()
          await hook.handleEvent({ type: "session.created" }, { info: { id: "ses_123" } })

          await hook.handleEvent(
            { type: "message.part.updated" },
            {
              info: {
                sessionID: "ses_123",
                role: "assistant",
                part: { id: "part_1", type: "tool-use" },
              },
            }
          )

          expect(onMatch).not.toHaveBeenCalled()
        })
      })
    })

    describe("#when message.part.updated includes props.delta", () => {
      describe("#then provided delta is used directly", () => {
        it("matches using delta even when part.text does not match", async () => {
          const { hook, onMatch } = createHook({ condition: ["^test-pattern$"] })
          await hook.handleEvent({ type: "session.created" }, { info: { id: "ses_123" } })

          await hook.handleEvent(
            { type: "message.part.updated" },
            {
              info: {
                sessionID: "ses_123",
                role: "assistant",
                part: { id: "part_1", type: "text", text: "unrelated text" },
              },
              delta: "test-pattern",
            }
          )

          expect(onMatch).toHaveBeenCalledTimes(1)
        })
      })
    })

    describe("#when message.part.updated has no props.delta", () => {
      describe("#then delta is computed from text offset", () => {
        it("matches using appended text for same part id", async () => {
          const { hook, onMatch } = createHook({ condition: ["^test-pattern$"] })
          await hook.handleEvent({ type: "session.created" }, { info: { id: "ses_123" } })

          await hook.handleEvent(
            { type: "message.part.updated" },
            {
              info: {
                sessionID: "ses_123",
                role: "assistant",
                part: { id: "part_1", type: "text", text: "hello " },
              },
            }
          )

          await hook.handleEvent({ type: "message.updated" }, { info: { sessionID: "ses_123" } })

          await hook.handleEvent(
            { type: "message.part.updated" },
            {
              info: {
                sessionID: "ses_123",
                role: "assistant",
                part: { id: "part_1", type: "text", text: "hello test-pattern" },
              },
            }
          )

          expect(onMatch).toHaveBeenCalledTimes(1)
        })
      })
    })
  })

  describe("#given TtsrHook with no initial rules", () => {
    describe("#when rules are added to existing managers", () => {
      describe("#then dynamically added rules can trigger onMatch", () => {
        it("calls onMatch for text matching the newly added rule", async () => {
          const onMatch = mock((_sessionID: string, _matchedRules: TtsrRule[]) => Promise.resolve())
          const hook = createTtsrHook({
            settings,
            rules: [],
            onMatch,
          })

          await hook.handleEvent({ type: "session.created" }, { info: { id: "ses_123" } })
          hook.addRulesToExistingManagers([
            createRule({ name: "added-rule", condition: ["late-pattern"] }),
          ])

          await hook.handleEvent(
            { type: "message.part.updated" },
            {
              info: {
                sessionID: "ses_123",
                role: "assistant",
                part: { id: "part_1", type: "text", text: "late-pattern" },
              },
            }
          )

          expect(onMatch).toHaveBeenCalledTimes(1)
        })
      })
    })
  })
})
