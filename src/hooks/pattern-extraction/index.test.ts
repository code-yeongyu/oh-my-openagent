import { describe, it, expect, beforeEach, mock } from "bun:test"
import { createPatternExtractionHook, PatternExtractionOptions } from "./index"

describe("PatternExtractionHook", () => {
  let mockCallback: ReturnType<typeof mock>

  beforeEach(() => {
    mockCallback = mock(() => {})
  })

  describe("createPatternExtractionHook", () => {
    //#given
    it("should return an event handler", () => {
      //#when
      const hook = createPatternExtractionHook()

      //#then
      expect(hook).toBeDefined()
      expect(hook.event).toBeDefined()
      expect(typeof hook.event).toBe("function")
    })

    //#given a summarize event with successful tool sequences
    it("should extract patterns from session history on summarize event", async () => {
      //#given
      const options: PatternExtractionOptions = {
        onPatternExtracted: mockCallback,
      }
      const hook = createPatternExtractionHook(options)

      const summarizeEvent = {
        event: "session.summarize",
        sessionID: "test-session-1",
        messages: [
          { role: "user", content: [{ type: "text", text: "Read file A" }] },
          { role: "assistant", content: [{ type: "tool_use", name: "read", input: {} }] },
          { role: "user", content: [{ type: "tool_result", tool_use_id: "1", content: "success" }] },
          { role: "assistant", content: [{ type: "tool_use", name: "edit", input: {} }] },
          { role: "user", content: [{ type: "tool_result", tool_use_id: "2", content: "success" }] },
          { role: "assistant", content: [{ type: "tool_use", name: "bash", input: {} }] },
          { role: "user", content: [{ type: "tool_result", tool_use_id: "3", content: "success" }] },
          // Repeat the pattern
          { role: "assistant", content: [{ type: "tool_use", name: "read", input: {} }] },
          { role: "user", content: [{ type: "tool_result", tool_use_id: "4", content: "success" }] },
          { role: "assistant", content: [{ type: "tool_use", name: "edit", input: {} }] },
          { role: "user", content: [{ type: "tool_result", tool_use_id: "5", content: "success" }] },
          { role: "assistant", content: [{ type: "tool_use", name: "bash", input: {} }] },
          { role: "user", content: [{ type: "tool_result", tool_use_id: "6", content: "success" }] },
          // Repeat again
          { role: "assistant", content: [{ type: "tool_use", name: "read", input: {} }] },
          { role: "user", content: [{ type: "tool_result", tool_use_id: "7", content: "success" }] },
          { role: "assistant", content: [{ type: "tool_use", name: "edit", input: {} }] },
          { role: "user", content: [{ type: "tool_result", tool_use_id: "8", content: "success" }] },
          { role: "assistant", content: [{ type: "tool_use", name: "bash", input: {} }] },
          { role: "user", content: [{ type: "tool_result", tool_use_id: "9", content: "success" }] },
        ],
        taskName: "implement-feature",
      }

      //#when
      await hook.event(summarizeEvent)

      //#then - should extract the repeated read->edit->bash pattern
      expect(mockCallback).toHaveBeenCalled()
      const call = (mockCallback as any).mock.calls[0][0]
      expect(call.name).toBe("repeated-workflow")
      expect(call.confidence).toBeGreaterThanOrEqual(0.7)
      expect(call.trigger).toContain("read")
      expect(call.source.sessionId).toBe("test-session-1")
      expect(call.source.taskName).toBe("implement-feature")
    })

    //#given a summarize event with patterns below confidence threshold
    it("should not call callback for patterns below 0.7 confidence", async () => {
      //#given
      const options: PatternExtractionOptions = {
        onPatternExtracted: mockCallback,
      }
      const hook = createPatternExtractionHook(options)

      const summarizeEvent = {
        event: "session.summarize",
        sessionID: "test-session-2",
        messages: [
          { role: "assistant", content: [{ type: "tool_use", name: "read", input: {} }] },
          { role: "user", content: [{ type: "tool_result", tool_use_id: "1", content: "success" }] },
          // Only one occurrence - low confidence
        ],
      }

      //#when
      await hook.event(summarizeEvent)

      //#then
      expect(mockCallback).not.toHaveBeenCalled()
    })

    //#given a summarize event with errors in tool sequence
    it("should filter out failed tool calls from pattern analysis", async () => {
      //#given
      const options: PatternExtractionOptions = {
        onPatternExtracted: mockCallback,
      }
      const hook = createPatternExtractionHook(options)

      const summarizeEvent = {
        event: "session.summarize",
        sessionID: "test-session-3",
        messages: [
          { role: "assistant", content: [{ type: "tool_use", name: "read", input: {} }] },
          { role: "user", content: [{ type: "tool_result", tool_use_id: "1", content: "error: file not found", is_error: true }] },
          { role: "assistant", content: [{ type: "tool_use", name: "edit", input: {} }] },
          { role: "user", content: [{ type: "tool_result", tool_use_id: "2", content: "success" }] },
        ],
      }

      //#when
      await hook.event(summarizeEvent)

      //#then - should not extract pattern due to error
      expect(mockCallback).not.toHaveBeenCalled()
    })

    //#given a non-summarize event
    it("should ignore non-summarize events", async () => {
      //#given
      const options: PatternExtractionOptions = {
        onPatternExtracted: mockCallback,
      }
      const hook = createPatternExtractionHook(options)

      const nonSummarizeEvent = {
        event: "session.deleted",
        sessionID: "test-session-4",
      }

      //#when
      await hook.event(nonSummarizeEvent)

      //#then
      expect(mockCallback).not.toHaveBeenCalled()
    })

    //#given no callback provided
    it("should not throw when callback is not provided", async () => {
      //#given
      const hook = createPatternExtractionHook()

      const summarizeEvent = {
        event: "session.summarize",
        sessionID: "test-session-5",
        messages: [
          { role: "assistant", content: [{ type: "tool_use", name: "read", input: {} }] },
          { role: "user", content: [{ type: "tool_result", tool_use_id: "1", content: "success" }] },
        ],
      }

      //#when
      await hook.event(summarizeEvent)

      //#then - should complete without throwing
      expect(true).toBe(true)
    })

    //#given callback throws error
    it("should not propagate callback errors", async () => {
      //#given
      const errorCallback = mock(() => { throw new Error("Callback error") })
      const options: PatternExtractionOptions = {
        onPatternExtracted: errorCallback,
      }
      const hook = createPatternExtractionHook(options)

      const summarizeEvent = {
        event: "session.summarize",
        sessionID: "test-session-6",
        messages: [
          { role: "assistant", content: [{ type: "tool_use", name: "read", input: {} }] },
          { role: "user", content: [{ type: "tool_result", tool_use_id: "1", content: "success" }] },
          { role: "assistant", content: [{ type: "tool_use", name: "edit", input: {} }] },
          { role: "user", content: [{ type: "tool_result", tool_use_id: "2", content: "success" }] },
          { role: "assistant", content: [{ type: "tool_use", name: "bash", input: {} }] },
          { role: "user", content: [{ type: "tool_result", tool_use_id: "3", content: "success" }] },
          // Repeat 2 more times
          { role: "assistant", content: [{ type: "tool_use", name: "read", input: {} }] },
          { role: "user", content: [{ type: "tool_result", tool_use_id: "4", content: "success" }] },
          { role: "assistant", content: [{ type: "tool_use", name: "edit", input: {} }] },
          { role: "user", content: [{ type: "tool_result", tool_use_id: "5", content: "success" }] },
          { role: "assistant", content: [{ type: "tool_use", name: "bash", input: {} }] },
          { role: "user", content: [{ type: "tool_result", tool_use_id: "6", content: "success" }] },
          { role: "assistant", content: [{ type: "tool_use", name: "read", input: {} }] },
          { role: "user", content: [{ type: "tool_result", tool_use_id: "7", content: "success" }] },
          { role: "assistant", content: [{ type: "tool_use", name: "edit", input: {} }] },
          { role: "user", content: [{ type: "tool_result", tool_use_id: "8", content: "success" }] },
          { role: "assistant", content: [{ type: "tool_use", name: "bash", input: {} }] },
          { role: "user", content: [{ type: "tool_result", tool_use_id: "9", content: "success" }] },
        ],
      }

      //#when
      await hook.event(summarizeEvent)

      //#then - should complete without throwing and callback was invoked
      expect(errorCallback).toHaveBeenCalled()
    })

    //#given multiple patterns detected
    it("should call callback for each pattern above threshold", async () => {
      //#given
      const options: PatternExtractionOptions = {
        onPatternExtracted: mockCallback,
      }
      const hook = createPatternExtractionHook(options)

      const summarizeEvent = {
        event: "session.summarize",
        sessionID: "test-session-7",
        messages: [
          // First pattern: read->edit->bash (3 times)
          { role: "assistant", content: [{ type: "tool_use", name: "read", input: {} }] },
          { role: "user", content: [{ type: "tool_result", tool_use_id: "1", content: "success" }] },
          { role: "assistant", content: [{ type: "tool_use", name: "edit", input: {} }] },
          { role: "user", content: [{ type: "tool_result", tool_use_id: "2", content: "success" }] },
          { role: "assistant", content: [{ type: "tool_use", name: "bash", input: {} }] },
          { role: "user", content: [{ type: "tool_result", tool_use_id: "3", content: "success" }] },
          { role: "assistant", content: [{ type: "tool_use", name: "read", input: {} }] },
          { role: "user", content: [{ type: "tool_result", tool_use_id: "4", content: "success" }] },
          { role: "assistant", content: [{ type: "tool_use", name: "edit", input: {} }] },
          { role: "user", content: [{ type: "tool_result", tool_use_id: "5", content: "success" }] },
          { role: "assistant", content: [{ type: "tool_use", name: "bash", input: {} }] },
          { role: "user", content: [{ type: "tool_result", tool_use_id: "6", content: "success" }] },
          { role: "assistant", content: [{ type: "tool_use", name: "read", input: {} }] },
          { role: "user", content: [{ type: "tool_result", tool_use_id: "7", content: "success" }] },
          { role: "assistant", content: [{ type: "tool_use", name: "edit", input: {} }] },
          { role: "user", content: [{ type: "tool_result", tool_use_id: "8", content: "success" }] },
          { role: "assistant", content: [{ type: "tool_use", name: "bash", input: {} }] },
          { role: "user", content: [{ type: "tool_result", tool_use_id: "9", content: "success" }] },
        ],
      }

      //#when
      await hook.event(summarizeEvent)

      //#then - should call callback at least once for repeated workflow
      expect((mockCallback as any).mock.calls.length).toBeGreaterThanOrEqual(1)
    })
  })
})
