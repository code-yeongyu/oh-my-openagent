declare const require: (name: string) => any
const { describe, test, expect, beforeEach, afterEach } = require("bun:test")
import { __setTimingConfig, __resetTimingConfig } from "./timing"

describe("executeUnstableAgentTask timeout handling", () => {
  beforeEach(() => {
    __setTimingConfig({
      POLL_INTERVAL_MS: 10,
      MIN_STABILITY_TIME_MS: 0,
      STABILITY_POLLS_REQUIRED: 1,
      WAIT_FOR_SESSION_TIMEOUT_MS: 100,
      WAIT_FOR_SESSION_INTERVAL_MS: 10,
    })
  })

  afterEach(() => {
    __resetTimingConfig()
  })

  test("returns timeout status instead of success when monitored poll budget is exhausted", async () => {
    // #given
    const { executeUnstableAgentTask } = require("./unstable-agent-task")

    const mockManager = {
      launch: async () => ({ id: "task_001", sessionID: "ses_timeout", status: "running" }),
      getTask: () => ({ id: "task_001", sessionID: "ses_timeout", status: "running" }),
    }

    const mockClient = {
      session: {
        status: async () => ({ data: { ses_timeout: { type: "running" } } }),
        messages: async () => ({
          data: [
            {
              info: { id: "msg_002", role: "assistant", time: { created: 2000 } },
              parts: [{ type: "text", text: "This should not be treated as success" }],
            },
          ],
        }),
      },
    }

    const args = {
      description: "timeout case",
      prompt: "run",
      category: "unspecified-low",
      run_in_background: false,
      load_skills: [],
      command: undefined,
    }

    // #when
    const result = await executeUnstableAgentTask(
      args,
      {
        sessionID: "parent-session",
        messageID: "parent-message",
        metadata: () => Promise.resolve(),
      },
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

    // #then
    expect(result).toContain("TIMED OUT")
    expect(result).not.toContain("SUPERVISED TASK COMPLETED SUCCESSFULLY")
  })
})
