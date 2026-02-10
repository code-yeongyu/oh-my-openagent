declare const require: (name: string) => any
const { describe, test, expect, beforeEach, afterEach } = require("bun:test")
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
    test("detects completion when assistant message has terminal finish reason", async () => {
      //#given - session messages with a terminal assistant finish ("end_turn")
      //         and the assistant id > user id (native opencode condition)
      const { pollSyncSession } = require("./sync-session-poller")

      let pollCount = 0
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

      //#when
      const result = await pollSyncSession(createMockCtx(), mockClient, {
        sessionID: "ses_test",
        agentToUse: "test-agent",
        toastManager: null,
        taskId: undefined,
      })

      //#then - should return null (success, no error)
      expect(result).toBeNull()
    })

    test("keeps polling when assistant finish is tool-calls (non-terminal)", async () => {
      //#given - first poll returns tool-calls finish, second returns end_turn
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

      //#when
      const result = await pollSyncSession(createMockCtx(), mockClient, {
        sessionID: "ses_test",
        agentToUse: "test-agent",
        toastManager: null,
        taskId: undefined,
      })

      //#then
      expect(result).toBeNull()
      expect(callCount).toBeGreaterThan(2)
    })

    test("keeps polling when finish is 'unknown' (non-terminal)", async () => {
      //#given
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

      //#when
      const result = await pollSyncSession(createMockCtx(), mockClient, {
        sessionID: "ses_test",
        agentToUse: "test-agent",
        toastManager: null,
        taskId: undefined,
      })

      //#then
      expect(result).toBeNull()
      expect(callCount).toBeGreaterThan(1)
    })

    test("does not complete when assistant id < user id (user sent after assistant)", async () => {
      //#given - assistant finished but user message came after it (agent still processing)
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

      //#when
      const result = await pollSyncSession(createMockCtx(), mockClient, {
        sessionID: "ses_test",
        agentToUse: "test-agent",
        toastManager: null,
        taskId: undefined,
      })

      //#then
      expect(result).toBeNull()
      expect(callCount).toBeGreaterThan(1)
    })
  })

  describe("abort handling", () => {
    test("returns abort message when signal is aborted", async () => {
      //#given
      const { pollSyncSession } = require("./sync-session-poller")
      const mockClient = {
        session: {
          messages: async () => ({ data: [] }),
          status: async () => ({ data: {} }),
        },
      }

      //#when
      const result = await pollSyncSession(createMockCtx(true), mockClient, {
        sessionID: "ses_abort",
        agentToUse: "test-agent",
        toastManager: { removeTask: () => {} },
        taskId: "task_123",
      })

      //#then
      expect(result).toContain("Task aborted")
      expect(result).toContain("ses_abort")
    })
  })

  describe("timeout handling", () => {
    test("returns error string on timeout", async () => {
      //#given - never returns a terminal finish, but timeout is very short
      const { pollSyncSession } = require("./sync-session-poller")

      __setTimingConfig({
        POLL_INTERVAL_MS: 10,
        MIN_STABILITY_TIME_MS: 0,
        STABILITY_POLLS_REQUIRED: 1,
        MAX_POLL_TIME_MS: 0,
      })

      const mockClient = {
        session: {
          messages: async () => ({
            data: [
              { info: { id: "msg_001", role: "user", time: { created: 1000 } } },
            ],
          }),
          status: async () => ({ data: { "ses_timeout": { type: "idle" } } }),
        },
      }

      //#when
      const result = await pollSyncSession(createMockCtx(), mockClient, {
        sessionID: "ses_timeout",
        agentToUse: "test-agent",
        toastManager: null,
        taskId: undefined,
      })

      //#then - timeout returns error string
      expect(result).toBe("Poll timeout reached after 50ms for session ses_timeout")
    })
  })

   describe("non-idle session status", () => {
     test("skips message check when session is not idle", async () => {
       //#given
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

       //#when
       const result = await pollSyncSession(createMockCtx(), mockClient, {
         sessionID: "ses_busy",
         agentToUse: "test-agent",
         toastManager: null,
         taskId: undefined,
       })

       //#then - should have waited for idle before checking messages
       expect(result).toBeNull()
       expect(statusCallCount).toBeGreaterThanOrEqual(3)
     })
   })

  describe("isSessionComplete edge cases", () => {
    test("returns false when messages array is empty", () => {
      const { isSessionComplete } = require("./sync-session-poller")

      //#given - empty messages array
      const messages: any[] = []

      //#when
      const result = isSessionComplete(messages)

      //#then - should return false
      expect(result).toBe(false)
    })

    test("returns false when no assistant message exists", () => {
      const { isSessionComplete } = require("./sync-session-poller")

      //#given - only user messages, no assistant
      const messages = [
        { info: { id: "msg_001", role: "user", time: { created: 1000 } } },
        { info: { id: "msg_002", role: "user", time: { created: 2000 } } },
      ]

      //#when
      const result = isSessionComplete(messages)

      //#then - should return false
      expect(result).toBe(false)
    })

    test("returns false when only assistant message exists (no user)", () => {
      const { isSessionComplete } = require("./sync-session-poller")

      //#given - only assistant message, no user message
      const messages = [
        {
          info: { id: "msg_001", role: "assistant", time: { created: 1000 }, finish: "end_turn" },
          parts: [{ type: "text", text: "Response" }],
        },
      ]

      //#when
      const result = isSessionComplete(messages)

      //#then - should return false (no user message to compare IDs)
      expect(result).toBe(false)
    })

    test("returns false when assistant message has missing finish field", () => {
      const { isSessionComplete } = require("./sync-session-poller")

      //#given - assistant message without finish field
      const messages = [
        { info: { id: "msg_001", role: "user", time: { created: 1000 } } },
        {
          info: { id: "msg_002", role: "assistant", time: { created: 2000 } },
          parts: [{ type: "text", text: "Response" }],
        },
      ]

      //#when
      const result = isSessionComplete(messages)

      //#then - should return false (missing finish)
      expect(result).toBe(false)
    })

    test("returns false when assistant message has missing info.id field", () => {
      const { isSessionComplete } = require("./sync-session-poller")

      //#given - assistant message without id in info
      const messages = [
        { info: { id: "msg_001", role: "user", time: { created: 1000 } } },
        {
          info: { role: "assistant", time: { created: 2000 }, finish: "end_turn" },
          parts: [{ type: "text", text: "Response" }],
        },
      ]

      //#when
      const result = isSessionComplete(messages)

      //#then - should return false (missing assistant id)
      expect(result).toBe(false)
    })

    test("returns false when user message has missing info.id field", () => {
      const { isSessionComplete } = require("./sync-session-poller")

      //#given - user message without id in info
      const messages = [
        { info: { role: "user", time: { created: 1000 } } },
        {
          info: { id: "msg_002", role: "assistant", time: { created: 2000 }, finish: "end_turn" },
          parts: [{ type: "text", text: "Response" }],
        },
      ]

      //#when
      const result = isSessionComplete(messages)

      //#then - should return false (missing user id)
      expect(result).toBe(false)
  })
})

})
