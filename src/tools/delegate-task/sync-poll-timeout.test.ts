declare const require: (name: string) => any
const { describe, test, expect, beforeEach, afterEach } = require("bun:test")
import { __setTimingConfig, __resetTimingConfig, DEFAULT_SYNC_POLL_TIMEOUT_MS } from "./timing"

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

function createNeverCompleteClient(sessionID: string) {
  return {
    session: {
      messages: async () => ({
        data: [{ info: { id: "msg_001", role: "user", time: { created: 1000 } } }],
      }),
      status: async () => ({ data: { [sessionID]: { type: "idle" } } }),
    },
  }
}

async function withMockedDateNow(stepMs: number, run: () => Promise<void>) {
  const originalDateNow = Date.now
  let now = 0

  Date.now = () => {
    const current = now
    now += stepMs
    return current
  }

  try {
    await run()
  } finally {
    Date.now = originalDateNow
  }
}

describe("syncPollTimeoutMs threading", () => {
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

  describe("#given pollSyncSession timeoutMs input", () => {
    describe("#when custom timeout is provided", () => {
      test("#then custom timeout value is used", async () => {
        const { pollSyncSession } = require("./sync-session-poller")
        const mockClient = createNeverCompleteClient("ses_custom")

        await withMockedDateNow(60_000, async () => {
          const result = await pollSyncSession(createMockCtx(), mockClient, {
            sessionID: "ses_custom",
            agentToUse: "test-agent",
            toastManager: null,
            taskId: undefined,
          }, 120_000)

          expect(result).toBe("Poll timeout reached after 120000ms for session ses_custom")
        })
      })
    })

    describe("#when timeoutMs is omitted", () => {
      test("#then default timeout constant is used", async () => {
        const { pollSyncSession } = require("./sync-session-poller")
        const mockClient = createNeverCompleteClient("ses_default")

        expect(DEFAULT_SYNC_POLL_TIMEOUT_MS).toBe(600_000)

        await withMockedDateNow(300_000, async () => {
          const result = await pollSyncSession(createMockCtx(), mockClient, {
            sessionID: "ses_default",
            agentToUse: "test-agent",
            toastManager: null,
            taskId: undefined,
          })

          expect(result).toBe(`Poll timeout reached after ${DEFAULT_SYNC_POLL_TIMEOUT_MS}ms for session ses_default`)
        })
      })
    })

    describe("#when timeoutMs is lower than minimum guard", () => {
      test("#then minimum 50ms timeout is enforced", async () => {
        const { pollSyncSession } = require("./sync-session-poller")
        const mockClient = createNeverCompleteClient("ses_guard")

        await withMockedDateNow(25, async () => {
          const result = await pollSyncSession(createMockCtx(), mockClient, {
            sessionID: "ses_guard",
            agentToUse: "test-agent",
            toastManager: null,
            taskId: undefined,
          }, 10)

          expect(result).toBe("Poll timeout reached after 50ms for session ses_guard")
        })
      })
    })
  })

  describe("#given unstable-agent-task path", () => {
    describe("#when syncPollTimeoutMs is set in executor context", () => {
      test("#then unstable path uses configured timeout budget", async () => {
        const { executeUnstableAgentTask } = require("./unstable-agent-task")

        let statusCallCount = 0
        const mockClient = {
          session: {
            status: async () => {
              statusCallCount++
              return { data: { ses_unstable: { type: "idle" } } }
            },
            messages: async () => ({
              data: [
                {
                  info: { id: "msg_001", role: "assistant", time: { created: 2000 } },
                  parts: [{ type: "text", text: "unstable path done" }],
                },
              ],
            }),
          },
        }

        const mockManager = {
          launch: async () => ({ id: "task_001", sessionID: "ses_unstable", status: "running" }),
          getTask: () => ({ id: "task_001", sessionID: "ses_unstable", status: "running" }),
        }

        const result = await executeUnstableAgentTask(
          {
            description: "unstable timeout threading",
            prompt: "run",
            category: "unspecified-low",
            run_in_background: false,
            load_skills: [],
            command: undefined,
          },
          createMockCtx(),
          {
            manager: mockManager,
            client: mockClient,
            syncPollTimeoutMs: 0,
          },
          {
            sessionID: "parent-session",
            messageID: "parent-message",
            model: "gpt-test",
            agent: "test-agent",
          },
          "test-agent",
          undefined,
          undefined,
          "gpt-test"
        )

        expect(statusCallCount).toBe(0)
        expect(result).toContain("SUPERVISED TASK COMPLETED SUCCESSFULLY")
      })
    })
  })
})
