import { describe, it, expect, beforeEach, mock } from "bun:test"
import { createObserverDetectorHook, type DelegateTaskFn } from "./index"

// Mock the log function from shared/logger
const logMessages: string[] = []
mock.module("../../shared/logger", () => ({
  log: (message: string, meta?: Record<string, unknown>) => {
    logMessages.push(message + (meta ? ` ${JSON.stringify(meta)}` : ""))
  },
}))

describe("observer-detector hook", () => {
  let hook: ReturnType<typeof createObserverDetectorHook>

  beforeEach(() => {
    logMessages.length = 0 // Clear messages
    hook = createObserverDetectorHook()
  })

  //#given a PostToolUse hook handler
  it("should return a tool.execute.after handler", () => {
    //#then
    expect(hook["tool.execute.after"]).toBeDefined()
    expect(typeof hook["tool.execute.after"]).toBe("function")
  })

  //#given consecutive tool calls
  describe("loop detection", () => {
    //#when same tool called 3+ times consecutively
    it("should detect loop when same tool called 3 times", async () => {
      //#given
      const sessionID = "test-session-1"
      const toolName = "bash"
      const input = { tool: toolName, sessionID, callID: "call-1" }
      const output = { title: "Success", output: "ok", metadata: {} }

      //#when
      await hook["tool.execute.after"](input, output)
      await hook["tool.execute.after"]({ ...input, callID: "call-2" }, output)
      await hook["tool.execute.after"]({ ...input, callID: "call-3" }, output)

      //#then
      expect(logMessages.some((msg) => msg.includes("loop detected"))).toBe(true)
      expect(logMessages.some((msg) => msg.includes("bash"))).toBe(true)
      expect(logMessages.some((msg) => msg.includes("3 times"))).toBe(true)
    })

    //#when different tools called
    it("should not detect loop when different tools called", async () => {
      //#given
      const sessionID = "test-session-2"

      //#when
      await hook["tool.execute.after"](
        { tool: "bash", sessionID, callID: "call-1" },
        { title: "Success", output: "ok", metadata: {} }
      )
      await hook["tool.execute.after"](
        { tool: "read", sessionID, callID: "call-2" },
        { title: "Success", output: "ok", metadata: {} }
      )
      await hook["tool.execute.after"](
        { tool: "bash", sessionID, callID: "call-3" },
        { title: "Success", output: "ok", metadata: {} }
      )

      //#then
      expect(logMessages.some((msg) => msg.includes("loop detected"))).toBe(false)
    })

    //#when loop count resets after different tool
    it("should reset consecutive count when different tool called", async () => {
      //#given
      const sessionID = "test-session-3"

      //#when
      await hook["tool.execute.after"](
        { tool: "bash", sessionID, callID: "call-1" },
        { title: "Success", output: "ok", metadata: {} }
      )
      await hook["tool.execute.after"](
        { tool: "bash", sessionID, callID: "call-2" },
        { title: "Success", output: "ok", metadata: {} }
      )
      await hook["tool.execute.after"](
        { tool: "read", sessionID, callID: "call-3" },
        { title: "Success", output: "ok", metadata: {} }
      )
      await hook["tool.execute.after"](
        { tool: "bash", sessionID, callID: "call-4" },
        { title: "Success", output: "ok", metadata: {} }
      )

      //#then - no loop warning because count reset
      expect(logMessages.some((msg) => msg.includes("loop detected"))).toBe(false)
    })
  })

  //#given tool failure detection
  describe("failure detection", () => {
    //#when 2+ consecutive failures
    it("should detect failures when error in output", async () => {
      //#given
      const sessionID = "test-session-4"
      const errorOutput = { title: "Error", output: "Error: command failed", metadata: {} }

      //#when
      await hook["tool.execute.after"](
        { tool: "bash", sessionID, callID: "call-1" },
        errorOutput
      )
      await hook["tool.execute.after"](
        { tool: "bash", sessionID, callID: "call-2" },
        errorOutput
      )

      //#then
      expect(logMessages.some((msg) => msg.includes("consecutive failures"))).toBe(true)
    })

    //#when success after failure
    it("should reset failure count on success", async () => {
      //#given
      const sessionID = "test-session-5"
      const errorOutput = { title: "Error", output: "Error: failed", metadata: {} }
      const successOutput = { title: "Success", output: "ok", metadata: {} }

      //#when
      await hook["tool.execute.after"](
        { tool: "bash", sessionID, callID: "call-1" },
        errorOutput
      )
      await hook["tool.execute.after"](
        { tool: "bash", sessionID, callID: "call-2" },
        successOutput
      )
      await hook["tool.execute.after"](
        { tool: "bash", sessionID, callID: "call-3" },
        errorOutput
      )

      //#then - no consecutive failure warning because count reset
      expect(logMessages.some((msg) => msg.includes("consecutive failures"))).toBe(false)
    })
  })

  //#given tool call counter
  describe("call counter", () => {
    //#when 20 calls made
    it("should trigger L2 flag at 20 calls", async () => {
      //#given
      const sessionID = "test-session-6"
      const output = { title: "Success", output: "ok", metadata: {} }

      //#when - make 20 calls
      for (let i = 1; i <= 20; i++) {
        await hook["tool.execute.after"](
          { tool: `tool-${i % 3}`, sessionID, callID: `call-${i}` },
          output
        )
      }

      //#then
      expect(logMessages.some((msg) => msg.includes("20 tool calls reached"))).toBe(true)
      expect(logMessages.some((msg) => msg.includes("L2 analysis"))).toBe(true)
    })

    //#when less than 20 calls
    it("should not trigger L2 flag before 20 calls", async () => {
      //#given
      const sessionID = "test-session-7"
      const output = { title: "Success", output: "ok", metadata: {} }

      //#when - make 19 calls
      for (let i = 1; i <= 19; i++) {
        await hook["tool.execute.after"](
          { tool: `tool-${i % 3}`, sessionID, callID: `call-${i}` },
          output
        )
      }

      //#then
      expect(logMessages.some((msg) => msg.includes("20 tool calls reached"))).toBe(false)
    })
  })

  //#given session isolation
  describe("session isolation", () => {
    //#when different sessions
    it("should track state separately per session", async () => {
      //#given
      const session1 = "session-1"
      const session2 = "session-2"
      const output = { title: "Success", output: "ok", metadata: {} }

      //#when - session1 makes 2 bash calls, session2 makes 1
      await hook["tool.execute.after"](
        { tool: "bash", sessionID: session1, callID: "call-1" },
        output
      )
      await hook["tool.execute.after"](
        { tool: "bash", sessionID: session1, callID: "call-2" },
        output
      )
      await hook["tool.execute.after"](
        { tool: "bash", sessionID: session2, callID: "call-3" },
        output
      )
      await hook["tool.execute.after"](
        { tool: "bash", sessionID: session1, callID: "call-4" },
        output
      )

      //#then - session1 should trigger loop (3 consecutive), session2 should not
      const loopMessages = logMessages.filter((msg) => msg.includes("loop detected"))
      expect(loopMessages.length).toBe(1)
    })
  })

  //#given event handler for cleanup
  describe("event handler", () => {
    //#when session.deleted event
    it("should have event handler for cleanup", () => {
      //#then
      expect(hook).toHaveProperty("event")
      expect(typeof hook.event).toBe("function")
    })
  })

  //#given L2 periodic analysis
  describe("L2 trigger", () => {
    //#when 20 calls made with delegateTask provided
    it("should call delegateTask with observer agent at 20 calls", async () => {
      //#given
      const sessionID = "test-session-l2"
      const output = { title: "Success", output: "ok", metadata: {} }
      let delegateCalled = false
      let delegateArgs: { subagent_type: string; run_in_background: boolean; prompt: string } | null = null

      const mockDelegateTask: DelegateTaskFn = async (args) => {
        delegateCalled = true
        delegateArgs = args
        return { success: true }
      }

      const hookWithDelegate = createObserverDetectorHook({ delegateTask: mockDelegateTask })

      //#when - make 20 calls
      for (let i = 1; i <= 20; i++) {
        await hookWithDelegate["tool.execute.after"](
          { tool: `tool-${i % 3}`, sessionID, callID: `call-${i}` },
          output
        )
      }

      // Wait a tick for async delegate call
      await new Promise((resolve) => setTimeout(resolve, 10))

      //#then
      expect(delegateCalled).toBe(true)
      expect(delegateArgs).not.toBeNull()
      expect(delegateArgs!.subagent_type).toBe("observer")
      expect(delegateArgs!.run_in_background).toBe(true)
      expect(delegateArgs!.prompt).toContain("Analyze the last 20 tool calls")
    })

    //#when 40 calls made
    it("should trigger L2 again at 40 calls", async () => {
      //#given
      const sessionID = "test-session-l2-periodic"
      const output = { title: "Success", output: "ok", metadata: {} }
      let delegateCallCount = 0

      const mockDelegateTask: DelegateTaskFn = async () => {
        delegateCallCount++
        return { success: true }
      }

      const hookWithDelegate = createObserverDetectorHook({ delegateTask: mockDelegateTask })

      //#when - make 40 calls
      for (let i = 1; i <= 40; i++) {
        await hookWithDelegate["tool.execute.after"](
          { tool: `tool-${i % 5}`, sessionID, callID: `call-${i}` },
          output
        )
      }

      // Wait a tick for async delegate calls
      await new Promise((resolve) => setTimeout(resolve, 10))

      //#then - should have triggered twice (at 20 and 40)
      expect(delegateCallCount).toBe(2)
    })

    //#when delegateTask fails
    it("should not throw if delegateTask fails", async () => {
      //#given
      const sessionID = "test-session-l2-fail"
      const output = { title: "Success", output: "ok", metadata: {} }

      const mockDelegateTask: DelegateTaskFn = async () => {
        throw new Error("Delegate failed")
      }

      const hookWithDelegate = createObserverDetectorHook({ delegateTask: mockDelegateTask })

      //#when - make 20 calls
      for (let i = 1; i <= 20; i++) {
        await hookWithDelegate["tool.execute.after"](
          { tool: `tool-${i % 3}`, sessionID, callID: `call-${i}` },
          output
        )
      }

      // Wait a tick for async delegate call
      await new Promise((resolve) => setTimeout(resolve, 10))

      //#then - should not throw, should log warning
      expect(logMessages.some((msg) => msg.includes("L2 analysis dispatch failed"))).toBe(true)
    })

    //#when no delegateTask provided
    it("should not throw without delegateTask callback", async () => {
      //#given
      const sessionID = "test-session-no-delegate"
      const output = { title: "Success", output: "ok", metadata: {} }
      const hookWithoutDelegate = createObserverDetectorHook()

      //#when - make 20 calls (should not throw)
      for (let i = 1; i <= 20; i++) {
        await hookWithoutDelegate["tool.execute.after"](
          { tool: `tool-${i % 3}`, sessionID, callID: `call-${i}` },
          output
        )
      }

      //#then - should complete without error
      expect(logMessages.some((msg) => msg.includes("20 tool calls reached"))).toBe(true)
    })

    //#when L2 triggered, prompt includes tool summary
    it("should include tool call summary in L2 prompt", async () => {
      //#given
      const sessionID = "test-session-summary"
      let capturedPrompt = ""

      const mockDelegateTask: DelegateTaskFn = async (args) => {
        capturedPrompt = args.prompt
        return { success: true }
      }

      const hookWithDelegate = createObserverDetectorHook({ delegateTask: mockDelegateTask })

      //#when - make calls with specific tools
      for (let i = 1; i <= 20; i++) {
        const tool = i <= 10 ? "bash" : "read"
        const output = i % 5 === 0
          ? { title: "Error", output: "Error: something failed", metadata: {} }
          : { title: "Success", output: "ok", metadata: {} }
        await hookWithDelegate["tool.execute.after"](
          { tool, sessionID, callID: `call-${i}` },
          output
        )
      }

      await new Promise((resolve) => setTimeout(resolve, 10))

      //#then
      expect(capturedPrompt).toContain("bash")
      expect(capturedPrompt).toContain("read")
      expect(capturedPrompt).toContain("failed")
    })
  })
})
