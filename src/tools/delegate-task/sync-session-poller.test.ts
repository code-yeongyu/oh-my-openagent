import { afterEach, beforeEach, describe, expect, test } from "bun:test"
declare const require: (name: string) => any
import { __setTimingConfig, __resetTimingConfig } from "./timing"

function createMockCtx(aborted = false) {
  const controller = new AbortController()
  if (aborted) controller.abort()
  return {
    sessionID: "parent-session",
    messageID: "parent-message",
    agent: "test-agent",
    abort: controller.signal,
  }
}

describe("pollSyncSession", () => {
  beforeEach(() => {
    __setTimingConfig({
      POLL_INTERVAL_MS: 10,
      MIN_STABILITY_TIME_MS: 0,
      STABILITY_POLLS_REQUIRED: 1,
      MAX_POLL_TIME_MS: 5000,
    })
  })

  afterEach(() => {
    __resetTimingConfig()
  })

  describe("native finish-based completion", () => {
    test("returns terminal session error when assistant message contains info.error", async () => {
      // given: error in assistant message
      const { pollSyncSession } = require("./sync-session-poller")

      const mockClient = {
        session: {
          messages: async () => ({
            data: [
              { info: { id: "msg_001", role: "user", time: { created: 1000 } } },
              {
                info: {
                  id: "msg_002",
                  role: "assistant",
                  time: { created: 2000 },
                  error: { data: { message: "Forbidden: Selected provider is forbidden" } },
                },
                parts: [],
              },
            ],
          }),
          status: async () => ({ data: { "ses_test": { type: "idle" } } }),
        },
      }

      // when: calling pollSyncSession
      const result = await pollSyncSession(createMockCtx(), mockClient, {
        sessionID: "ses_test",
        agentToUse: "test-agent",
        toastManager: null,
        taskId: undefined,
      })

      // then: returns error message
      expect(result).toBe("Forbidden: Selected provider is forbidden")
    })

    test("ignores stale prior-turn assistant errors after a new user turn starts", async () => {
      // given: prior error exists but user sent new message
      const { pollSyncSession } = require("./sync-session-poller")

      const mockClient = {
        session: {
          messages: async () => ({
            data: [
              { info: { id: "msg_001", role: "user", time: { created: 1000 } } },
              {
                info: {
                  id: "msg_002",
                  role: "assistant",
                  time: { created: 2000 },
                  error: { data: { message: "Forbidden: Selected provider is forbidden" } },
                },
                parts: [],
              },
              { info: { id: "msg_003", role: "user", time: { created: 3000 } } },
            ],
          }),
          status: async () => ({ data: { "ses_test": { type: "idle" } } }),
          abort: async () => ({}),
        },
      }

      // when: calling with stale error
      const result = await pollSyncSession(createMockCtx(), mockClient, {
        sessionID: "ses_test",
        agentToUse: "test-agent",
        toastManager: null,
        taskId: undefined,
        anchorMessageCount: 2,
      }, 50)

      // then: times out (ignores stale error)
      expect(result).toContain("Poll timeout reached")
    })

    test("detects completion when assistant message has terminal finish reason", async () => {
      // given: terminal assistant finish with assistant id > user id
      const { pollSyncSession } = require("./sync-session-poller")

      const mockClient = {
        session: {
          messages: async () => ({
            data: [
              { info: { id: "msg_001", role: "user", time: { created: 1000 } } },
              {
                info: { id: "msg_002", role: "assistant", time: { created: 2000 }, finish: "stop" },
                parts: [{ type: "text", text: "Done" }],
              },
            ],
          }),
          status: async () => ({ data: { "ses_test": { type: "idle" } } }),
        },
      }

      // when: calling pollSyncSession
      const result = await pollSyncSession(createMockCtx(), mockClient, {
        sessionID: "ses_test",
        agentToUse: "test-agent",
        toastManager: null,
        taskId: undefined,
      })

      // then: returns null (success)
      expect(result).toBeNull()
    })

    test("keeps polling when assistant finish is tool-calls (non-terminal)", async () => {
      // given: first poll returns tool-calls, second returns end_turn
      const { pollSyncSession } = require("./sync-session-poller")

      let callCount = 0
      const mockClient = {
        session: {
          messages: async () => {
            callCount++
            if (callCount <= 2) {
              return {
                data: [
                  { info: { id: "msg_001", role: "user", time: { created: 1000 } } },
                  {
                    info: { id: "msg_002", role: "assistant", time: { created: 2000 }, finish: "tool-calls" },
                    parts: [{ type: "tool-call", text: "calling tool" }],
                  },
                ],
              }
            }
            return {
              data: [
                { info: { id: "msg_001", role: "user", time: { created: 1000 } } },
                {
                  info: { id: "msg_002", role: "assistant", time: { created: 2000 }, finish: "tool-calls" },
                  parts: [{ type: "tool-call", text: "calling tool" }],
                },
                { info: { id: "msg_003", role: "user", time: { created: 3000 } } },
                {
                  info: { id: "msg_004", role: "assistant", time: { created: 4000 }, finish: "end_turn" },
                  parts: [{ type: "text", text: "Final answer" }],
                },
              ],
            }
          },
          status: async () => ({ data: { "ses_test": { type: "idle" } } }),
        },
      }

      // when: calling pollSyncSession
      const result = await pollSyncSession(createMockCtx(), mockClient, {
        sessionID: "ses_test",
        agentToUse: "test-agent",
        toastManager: null,
        taskId: undefined,
      })

      // then: returns null after polling continues
      expect(result).toBeNull()
      expect(callCount).toBeGreaterThan(2)
    })

    test("keeps polling when finish is 'unknown' (non-terminal)", async () => {
      // given: first poll returns unknown finish
      const { pollSyncSession } = require("./sync-session-poller")

      let callCount = 0
      const mockClient = {
        session: {
          messages: async () => {
            callCount++
            if (callCount <= 1) {
              return {
                data: [
                  { info: { id: "msg_001", role: "user", time: { created: 1000 } } },
                  {
                    info: { id: "msg_002", role: "assistant", time: { created: 2000 }, finish: "unknown" },
                    parts: [],
                  },
                ],
              }
            }
            return {
              data: [
                { info: { id: "msg_001", role: "user", time: { created: 1000 } } },
                {
                  info: { id: "msg_002", role: "assistant", time: { created: 2000 }, finish: "unknown" },
                  parts: [],
                },
                { info: { id: "msg_003", role: "user", time: { created: 3000 } } },
                {
                  info: { id: "msg_004", role: "assistant", time: { created: 4000 }, finish: "stop" },
                  parts: [{ type: "text", text: "Done" }],
                },
              ],
            }
          },
          status: async () => ({ data: { "ses_test": { type: "idle" } } }),
        },
      }

      // when: calling pollSyncSession
      const result = await pollSyncSession(createMockCtx(), mockClient, {
        sessionID: "ses_test",
        agentToUse: "test-agent",
        toastManager: null,
        taskId: undefined,
      })

      // then: returns null after polling continues
      expect(result).toBeNull()
      expect(callCount).toBeGreaterThan(1)
    })

    test("keeps polling when finish is 'stop' but assistant still has tool-call parts", async () => {
      // given: finish is stop but tool-call parts exist
      const { pollSyncSession } = require("./sync-session-poller")

      let callCount = 0
      const mockClient = {
        session: {
          messages: async () => {
            callCount++
            if (callCount <= 1) {
              return {
                data: [
                  { info: { id: "msg_001", role: "user", time: { created: 1000 } } },
                  {
                    info: { id: "msg_002", role: "assistant", time: { created: 2000 }, finish: "stop" },
                    parts: [{ type: "tool-call", text: "calling tool" }],
                  },
                ],
              }
            }
            return {
              data: [
                { info: { id: "msg_001", role: "user", time: { created: 1000 } } },
                {
                  info: { id: "msg_002", role: "assistant", time: { created: 2000 }, finish: "stop" },
                  parts: [{ type: "tool-call", text: "calling tool" }],
                },
                { info: { id: "msg_003", role: "user", time: { created: 3000 } } },
                {
                  info: { id: "msg_004", role: "assistant", time: { created: 4000 }, finish: "stop" },
                  parts: [{ type: "text", text: "Done" }],
                },
              ],
            }
          },
          status: async () => ({ data: { "ses_test": { type: "idle" } } }),
        },
      }

      // when: calling pollSyncSession
      const result = await pollSyncSession(createMockCtx(), mockClient, {
        sessionID: "ses_test",
        agentToUse: "test-agent",
        toastManager: null,
        taskId: undefined,
      })

      // then: returns null after polling continues
      expect(result).toBeNull()
      expect(callCount).toBeGreaterThan(1)
    })

    test("does not complete when assistant id < user id (user sent after assistant)", async () => {
      // given: assistant finished but user message came after it
      const { pollSyncSession } = require("./sync-session-poller")

      let callCount = 0
      const mockClient = {
        session: {
          messages: async () => {
            callCount++
            if (callCount <= 1) {
              return {
                data: [
                  { info: { id: "msg_001", role: "user", time: { created: 1000 } } },
                  {
                    info: { id: "msg_002", role: "assistant", time: { created: 2000 }, finish: "end_turn" },
                    parts: [{ type: "text", text: "Partial" }],
                  },
                  { info: { id: "msg_003", role: "user", time: { created: 3000 } } },
                ],
              }
            }
            return {
              data: [
                { info: { id: "msg_001", role: "user", time: { created: 1000 } } },
                {
                  info: { id: "msg_002", role: "assistant", time: { created: 2000 }, finish: "end_turn" },
                  parts: [{ type: "text", text: "Partial" }],
                },
                { info: { id: "msg_003", role: "user", time: { created: 3000 } } },
                {
                  info: { id: "msg_004", role: "assistant", time: { created: 4000 }, finish: "end_turn" },
                  parts: [{ type: "text", text: "Final" }],
                },
              ],
            }
          },
          status: async () => ({ data: { "ses_test": { type: "idle" } } }),
        },
      }

      // when: calling pollSyncSession
      const result = await pollSyncSession(createMockCtx(), mockClient, {
        sessionID: "ses_test",
        agentToUse: "test-agent",
        toastManager: null,
        taskId: undefined,
      })

      // then: returns null after polling continues
      expect(result).toBeNull()
      expect(callCount).toBeGreaterThan(1)
    })
  })

  describe("abort handling", () => {
    test("#given session completed AND abort fires #then returns completion result not abort", async () => {
      // given: session completes and abort fires
      const { pollSyncSession } = require("./sync-session-poller")
      const controller = new AbortController()
      controller.abort()

      let abortCount = 0
      let messageCallCount = 0
      const mockClient = {
        session: {
          abort: async () => {
            abortCount++
          },
          messages: async () => {
            messageCallCount++
            return {
              data: [
                { info: { id: "msg_001", role: "user", time: { created: 1000 } } },
                {
                  info: { id: "msg_002", role: "assistant", time: { created: 2000 }, finish: "stop" },
                  parts: [{ type: "text", text: "Done" }],
                },
              ],
            }
          },
          status: async () => ({ data: {} }),
        },
      }

      // when: calling pollSyncSession
      const result = await pollSyncSession({
        sessionID: "parent-session",
        messageID: "parent-message",
        agent: "test-agent",
        abort: controller.signal,
      }, mockClient, {
        sessionID: "ses_abort_complete",
        agentToUse: "test-agent",
        toastManager: { removeTask: () => {} },
        taskId: "task_123",
        anchorMessageCount: 1,
      })

      // then: returns null with no abort
      expect(result).toBeNull()
      expect(messageCallCount).toBe(1)
      expect(abortCount).toBe(0)
    })

    test("returns abort message when signal is aborted", async () => {
      // given: abort signal already aborted
      const { pollSyncSession } = require("./sync-session-poller")
      let abortCount = 0
      const mockClient = {
        session: {
          abort: async () => {
            abortCount++
          },
          messages: async () => ({ data: [] }),
          status: async () => ({ data: {} }),
        },
      }

      // when: calling pollSyncSession with aborted signal
      const result = await pollSyncSession(createMockCtx(true), mockClient, {
        sessionID: "ses_abort",
        agentToUse: "test-agent",
        toastManager: { removeTask: () => {} },
        taskId: "task_123",
      })

      // then: returns abort message
      expect(result).toContain("Task aborted")
      expect(result).toContain("ses_abort")
      expect(abortCount).toBe(1)
    })
  })

  describe("timeout handling", () => {
    test("returns error string on timeout", async () => {
      // given: no terminal finish and short timeout
      const { pollSyncSession } = require("./sync-session-poller")

      __setTimingConfig({
        POLL_INTERVAL_MS: 10,
        MIN_STABILITY_TIME_MS: 0,
        STABILITY_POLLS_REQUIRED: 1,
        MAX_POLL_TIME_MS: 0,
      })

      let abortCount = 0
      const mockClient = {
        session: {
          abort: async () => {
            abortCount++
          },
          messages: async () => ({
            data: [
              { info: { id: "msg_001", role: "user", time: { created: 1000 } } },
            ],
          }),
          status: async () => ({ data: { "ses_timeout": { type: "idle" } } }),
        },
      }

      // when: calling pollSyncSession
      const result = await pollSyncSession(createMockCtx(), mockClient, {
        sessionID: "ses_timeout",
        agentToUse: "test-agent",
        toastManager: null,
        taskId: undefined,
      }, 0)

      // then: returns timeout error
      expect(result).toBe("Poll timeout reached after 50ms for session ses_timeout")
      expect(abortCount).toBe(1)
    })
  })

  describe("non-idle session status", () => {
    test("skips message check when session is not idle", async () => {
      // given: session is running (not idle)
      const { pollSyncSession } = require("./sync-session-poller")

      let statusCallCount = 0
      let messageCallCount = 0
       const mockClient = {
         session: {
           messages: async () => {
             messageCallCount++
             return {
               data: [
                 { info: { id: "msg_001", role: "user", time: { created: 1000 } } },
                 {
                   info: { id: "msg_002", role: "assistant", time: { created: 2000 }, finish: "end_turn" },
                   parts: [{ type: "text", text: "Done" }],
                 },
               ],
             }
           },
           status: async () => {
             statusCallCount++
             if (statusCallCount <= 2) {
               return { data: { "ses_busy": { type: "running" } } }
             }
             return { data: { "ses_busy": { type: "idle" } } }
           },
         },
       }

      // when: calling pollSyncSession
      const result = await pollSyncSession(createMockCtx(), mockClient, {
        sessionID: "ses_busy",
        agentToUse: "test-agent",
        toastManager: null,
        taskId: undefined,
      })

      // then: waits for idle before checking messages
      expect(result).toBeNull()
      expect(statusCallCount).toBeGreaterThanOrEqual(3)
    })
  })

  describe("isSessionComplete edge cases", () => {
    test("returns false when messages array is empty", () => {
      const { isSessionComplete } = require("./sync-session-poller")

      // given: empty messages array
      const messages: any[] = []

      // when: calling isSessionComplete
      const result = isSessionComplete(messages)

      // then: returns false
      expect(result).toBe(false)
    })

    test("returns false when no assistant message exists", () => {
      const { isSessionComplete } = require("./sync-session-poller")

      // given: only user messages, no assistant
      const messages = [
        { info: { id: "msg_001", role: "user", time: { created: 1000 } } },
        { info: { id: "msg_002", role: "user", time: { created: 2000 } } },
      ]

      // when: calling isSessionComplete
      const result = isSessionComplete(messages)

      // then: returns false
      expect(result).toBe(false)
    })

    test("returns false when only assistant message exists (no user)", () => {
      const { isSessionComplete } = require("./sync-session-poller")

      // given: only assistant message, no user message
      const messages = [
        {
          info: { id: "msg_001", role: "assistant", time: { created: 1000 }, finish: "end_turn" },
          parts: [{ type: "text", text: "Response" }],
        },
      ]

      // when: calling isSessionComplete
      const result = isSessionComplete(messages)

      // then: returns false (no user message to compare IDs)
      expect(result).toBe(false)
    })

    test("returns false when assistant message has missing finish field", () => {
      const { isSessionComplete } = require("./sync-session-poller")

      // given: assistant message without finish field
      const messages = [
        { info: { id: "msg_001", role: "user", time: { created: 1000 } } },
        {
          info: { id: "msg_002", role: "assistant", time: { created: 2000 } },
          parts: [{ type: "text", text: "Response" }],
        },
      ]

      // when: calling isSessionComplete
      const result = isSessionComplete(messages)

      // then: returns false (missing finish)
      expect(result).toBe(false)
    })

    test("returns false when assistant message has missing info.id field", () => {
      const { isSessionComplete } = require("./sync-session-poller")

      // given: assistant message without id in info
      const messages = [
        { info: { id: "msg_001", role: "user", time: { created: 1000 } } },
        {
          info: { role: "assistant", time: { created: 2000 }, finish: "end_turn" },
          parts: [{ type: "text", text: "Response" }],
        },
      ]

      // when: calling isSessionComplete
      const result = isSessionComplete(messages)

      // then: returns false (missing assistant id)
      expect(result).toBe(false)
    })

    test("returns false when finish is stop but assistant has tool-call parts", () => {
      const { isSessionComplete } = require("./sync-session-poller")

      // given: provider marks stop even though tool execution is pending
      const messages = [
        { info: { id: "msg_001", role: "user", time: { created: 1000 } } },
        {
          info: { id: "msg_002", role: "assistant", time: { created: 2000 }, finish: "stop" },
          parts: [{ type: "tool-call", text: "calling tool" }],
        },
      ]

      // when: calling isSessionComplete
      const result = isSessionComplete(messages)

      // then: returns false because tool execution is still pending
      expect(result).toBe(false)
    })

    test("returns false when finish is end_turn but assistant has tool-call parts", () => {
      const { isSessionComplete } = require("./sync-session-poller")

      // given: assistant emitted terminal finish but contains pending tool calls
      const messages = [
        { info: { id: "msg_001", role: "user", time: { created: 1000 } } },
        {
          info: { id: "msg_002", role: "assistant", time: { created: 2000 }, finish: "end_turn" },
          parts: [{ type: "tool-call", text: "calling tool" }],
        },
      ]

      // when: calling isSessionComplete
      const result = isSessionComplete(messages)

      // then: returns false because tool execution is still pending
      expect(result).toBe(false)
    })

    test("returns false when user message has missing info.id field", () => {
      const { isSessionComplete } = require("./sync-session-poller")

      // given: user message without id in info
      const messages = [
        { info: { role: "user", time: { created: 1000 } } },
        {
          info: { id: "msg_002", role: "assistant", time: { created: 2000 }, finish: "end_turn" },
          parts: [{ type: "text", text: "Response" }],
        },
      ]

      // when: calling isSessionComplete
      const result = isSessionComplete(messages)

      // then: returns false (missing user id)
      expect(result).toBe(false)
    })
  })

})
