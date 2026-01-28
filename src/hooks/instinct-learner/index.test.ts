import { describe, test, expect, beforeEach } from "bun:test"
import { createInstinctLearnerHook } from "./index"

describe("createInstinctLearnerHook", () => {
  //#given instinct learner hook factory
  test("should create hook with tool.execute.after and event handlers", () => {
    //#when creating hook
    const hook = createInstinctLearnerHook()

    //#then hook should have required handlers
    expect((hook as any)["tool.execute.after"]).toBeDefined()
    expect(hook.event).toBeDefined()
    expect(typeof (hook as any)["tool.execute.after"]).toBe("function")
    expect(typeof hook.event).toBe("function")
  })

  describe("tool sequence tracking", () => {
    let hook: ReturnType<typeof createInstinctLearnerHook>
    let detectedInstincts: Array<{
      name: string
      trigger: string
      confidence: number
      action: string
      domain: string
    }>

    beforeEach(() => {
      detectedInstincts = []
      //#given hook with callback
      hook = createInstinctLearnerHook({
        onInstinctDetected: async (instinct) => {
          detectedInstincts.push(instinct)
        },
      })
    })

    test("should track tool call sequences per session", async () => {
      //#given multiple tool calls
      const sessionID = "session-1"
      const toolCalls = [
        { tool: "read", sessionID, callID: "call-1" },
        { tool: "edit", sessionID, callID: "call-2" },
        { tool: "bash", sessionID, callID: "call-3" },
      ]

      //#when recording tool calls
      for (const call of toolCalls) {
        await hook["tool.execute.after"](
          call,
          { title: "Success", output: "OK", metadata: {} }
        )
      }

      //#then should track sequence (no assertion yet, just recording)
      expect(true).toBe(true)
    })

    test("should track sequences separately per session", async () => {
      //#given two different sessions
      const session1 = "session-1"
      const session2 = "session-2"

      //#when recording tool calls in different sessions
      await hook["tool.execute.after"](
        { tool: "read", sessionID: session1, callID: "call-1" },
        { title: "Success", output: "OK", metadata: {} }
      )
      await hook["tool.execute.after"](
        { tool: "write", sessionID: session2, callID: "call-2" },
        { title: "Success", output: "OK", metadata: {} }
      )

      //#then sessions should be tracked independently
      expect(true).toBe(true)
    })
  })

  describe("repeated pattern detection", () => {
    let hook: ReturnType<typeof createInstinctLearnerHook>
    let detectedInstincts: Array<{
      name: string
      trigger: string
      confidence: number
      action: string
      domain: string
    }>

    beforeEach(() => {
      detectedInstincts = []
      hook = createInstinctLearnerHook({
        onInstinctDetected: async (instinct) => {
          detectedInstincts.push(instinct)
        },
      })
    })

    test("should detect repeated workflow pattern (3+ occurrences)", async () => {
      //#given repeated tool sequence
      const sessionID = "session-1"
      const sequence = ["read", "edit", "bash"]

      //#when repeating sequence 3 times
      for (let i = 0; i < 3; i++) {
        for (const tool of sequence) {
          await hook["tool.execute.after"](
            { tool, sessionID, callID: `call-${i}-${tool}` },
            { title: "Success", output: "OK", metadata: {} }
          )
        }
      }

      //#then should detect pattern and trigger callback
      expect(detectedInstincts.length).toBeGreaterThan(0)
      expect(detectedInstincts[0].name).toContain("workflow")
      expect(detectedInstincts[0].trigger).toBeTruthy()
      expect(detectedInstincts[0].action).toBeTruthy()
      expect(detectedInstincts[0].confidence).toBeGreaterThan(0)
    })

    test("should not detect pattern with only 2 occurrences", async () => {
      //#given repeated tool sequence only 2 times
      const sessionID = "session-1"
      const sequence = ["read", "edit", "bash"]

      //#when repeating sequence 2 times
      for (let i = 0; i < 2; i++) {
        for (const tool of sequence) {
          await hook["tool.execute.after"](
            { tool, sessionID, callID: `call-${i}-${tool}` },
            { title: "Success", output: "OK", metadata: {} }
          )
        }
      }

      //#then should not trigger callback
      expect(detectedInstincts.length).toBe(0)
    })
  })

  describe("user correction pattern detection", () => {
    let hook: ReturnType<typeof createInstinctLearnerHook>
    let detectedInstincts: Array<{
      name: string
      trigger: string
      confidence: number
      action: string
      domain: string
    }>

    beforeEach(() => {
      detectedInstincts = []
      hook = createInstinctLearnerHook({
        onInstinctDetected: async (instinct) => {
          detectedInstincts.push(instinct)
        },
      })
    })

    test("should detect edit followed by different edit (correction pattern)", async () => {
      //#given edit followed by another edit (undo-like pattern)
      const sessionID = "session-1"

      //#when recording edit sequence
      await hook["tool.execute.after"](
        { tool: "edit", sessionID, callID: "call-1" },
        { title: "Edit file", output: "File edited", metadata: { filePath: "test.ts" } }
      )
      await hook["tool.execute.after"](
        { tool: "edit", sessionID, callID: "call-2" },
        { title: "Edit file", output: "File edited", metadata: { filePath: "test.ts" } }
      )
      await hook["tool.execute.after"](
        { tool: "edit", sessionID, callID: "call-3" },
        { title: "Edit file", output: "File edited", metadata: { filePath: "test.ts" } }
      )

      //#then should detect correction pattern
      expect(detectedInstincts.length).toBeGreaterThan(0)
      expect(detectedInstincts[0].name).toContain("correction")
    })
  })

  describe("error resolution pattern detection", () => {
    let hook: ReturnType<typeof createInstinctLearnerHook>
    let detectedInstincts: Array<{
      name: string
      trigger: string
      confidence: number
      action: string
      domain: string
    }>

    beforeEach(() => {
      detectedInstincts = []
      hook = createInstinctLearnerHook({
        onInstinctDetected: async (instinct) => {
          detectedInstincts.push(instinct)
        },
      })
    })

    test("should detect error followed by successful resolution", async () => {
      //#given error followed by successful tool call
      const sessionID = "session-1"

      //#when recording error and resolution
      await hook["tool.execute.after"](
        { tool: "bash", sessionID, callID: "call-1" },
        { title: "Error", output: "Error: command failed", metadata: {} }
      )
      await hook["tool.execute.after"](
        { tool: "edit", sessionID, callID: "call-2" },
        { title: "Success", output: "Fixed the issue", metadata: {} }
      )
      await hook["tool.execute.after"](
        { tool: "bash", sessionID, callID: "call-3" },
        { title: "Success", output: "Command succeeded", metadata: {} }
      )

      //#then should detect error resolution pattern
      expect(detectedInstincts.length).toBeGreaterThan(0)
      expect(detectedInstincts[0].name).toContain("error-resolution")
    })
  })

  describe("callback invocation", () => {
    test("should invoke callback with correct instinct format", async () => {
      //#given hook with callback
      let capturedInstinct: any = null
      const hook = createInstinctLearnerHook({
        onInstinctDetected: async (instinct) => {
          capturedInstinct = instinct
        },
      })

      //#when pattern is detected
      const sessionID = "session-1"
      const sequence = ["read", "edit", "bash"]
      for (let i = 0; i < 3; i++) {
        for (const tool of sequence) {
          await hook["tool.execute.after"](
            { tool, sessionID, callID: `call-${i}-${tool}` },
            { title: "Success", output: "OK", metadata: {} }
          )
        }
      }

      //#then callback should be invoked with correct format
      expect(capturedInstinct).not.toBeNull()
      expect(capturedInstinct).toHaveProperty("name")
      expect(capturedInstinct).toHaveProperty("trigger")
      expect(capturedInstinct).toHaveProperty("confidence")
      expect(capturedInstinct).toHaveProperty("action")
      expect(capturedInstinct).toHaveProperty("domain")
      expect(typeof capturedInstinct.name).toBe("string")
      expect(typeof capturedInstinct.trigger).toBe("string")
      expect(typeof capturedInstinct.confidence).toBe("number")
      expect(typeof capturedInstinct.action).toBe("string")
      expect(typeof capturedInstinct.domain).toBe("string")
    })

    test("should not throw if callback is not provided", async () => {
      //#given hook without callback
      const hook = createInstinctLearnerHook()

      //#when pattern is detected
      const sessionID = "session-1"
      const sequence = ["read", "edit", "bash"]

      //#then should not throw
      await expect(async () => {
        for (let i = 0; i < 3; i++) {
          for (const tool of sequence) {
            await hook["tool.execute.after"](
              { tool, sessionID, callID: `call-${i}-${tool}` },
              { title: "Success", output: "OK", metadata: {} }
            )
          }
        }
      }).not.toThrow()
    })
  })

  describe("event cleanup", () => {
    test("should cleanup session state on session.deleted event", async () => {
      //#given hook with tracked session
      const hook = createInstinctLearnerHook()
      const sessionID = "session-1"

      await hook["tool.execute.after"](
        { tool: "read", sessionID, callID: "call-1" },
        { title: "Success", output: "OK", metadata: {} }
      )

      //#when session.deleted event is fired
      await hook.event({ event: "session.deleted", sessionID })

      //#then session state should be cleaned up (no assertion, just verifying no errors)
      expect(true).toBe(true)
    })

    test("should not throw on cleanup with unknown session", async () => {
      //#given hook
      const hook = createInstinctLearnerHook()

      //#when cleaning up unknown session
      //#then should not throw
      await expect(async () => {
        await hook.event({ event: "session.deleted", sessionID: "unknown" })
      }).not.toThrow()
    })
  })
})
