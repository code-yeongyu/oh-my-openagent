declare const require: (name: string) => any
const { describe, test, expect, beforeEach, afterEach } = require("bun:test")

import { __resetTimingConfig, __setTimingConfig } from "./timing"

function createArgs() {
  return {
    description: "cleanup case",
    prompt: "run",
    category: "unspecified-low",
    run_in_background: false,
    load_skills: [],
    command: undefined,
  }
}

function createToolContext(aborted = false) {
  const controller = new AbortController()
  if (aborted) {
    controller.abort()
  }

  return {
    sessionID: "parent-session",
    messageID: "parent-message",
    agent: "test-agent",
    abort: controller.signal,
    metadata: () => Promise.resolve(),
  }
}

function createParentContext() {
  return {
    sessionID: "parent-session",
    messageID: "parent-message",
    model: "gpt-test",
    agent: "test-agent",
  }
}

describe("executeUnstableAgentTask cleanup", () => {
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

  test("cancels launched task when parent aborts during monitoring", async () => {
    // given
    const { executeUnstableAgentTask } = require("./unstable-agent-task")
    const cancelCalls: Array<{ taskId: string; options?: Record<string, unknown> }> = []

    const mockManager = {
      launch: async () => ({ id: "bg_abort_monitoring", sessionID: "ses_abort_monitoring", status: "running" }),
      getTask: () => ({ id: "bg_abort_monitoring", sessionID: "ses_abort_monitoring", status: "running" }),
      cancelTask: async (taskId: string, options?: Record<string, unknown>) => {
        cancelCalls.push({ taskId, options })
        return true
      },
    }

    // when
    const result = await executeUnstableAgentTask(
      createArgs(),
      createToolContext(true),
      {
        manager: mockManager,
        client: {
          session: {
            status: async () => ({ data: {} }),
            messages: async () => ({ data: [] }),
          },
        },
      },
      createParentContext(),
      "test-agent",
      undefined,
      undefined,
      "gpt-test"
    )

    // then
    expect(result).toContain("Task aborted (was running in background mode).")
    expect(cancelCalls).toHaveLength(1)
    expect(cancelCalls[0]?.taskId).toBe("bg_abort_monitoring")
  })

  test("cancels launched task when monitored timeout budget is exhausted", async () => {
    // given
    const { executeUnstableAgentTask } = require("./unstable-agent-task")
    const cancelCalls: Array<{ taskId: string; options?: Record<string, unknown> }> = []

    const mockManager = {
      launch: async () => ({ id: "bg_timeout_cleanup", sessionID: "ses_timeout_cleanup", status: "running" }),
      getTask: () => ({ id: "bg_timeout_cleanup", sessionID: "ses_timeout_cleanup", status: "running" }),
      cancelTask: async (taskId: string, options?: Record<string, unknown>) => {
        cancelCalls.push({ taskId, options })
        return true
      },
    }

    // when
    const result = await executeUnstableAgentTask(
      createArgs(),
      createToolContext(),
      {
        manager: mockManager,
        client: {
          session: {
            status: async () => ({ data: { ses_timeout_cleanup: { type: "busy" } } }),
            messages: async () => ({ data: [] }),
          },
        },
        syncPollTimeoutMs: 0,
      },
      createParentContext(),
      "test-agent",
      undefined,
      undefined,
      "gpt-test"
    )

    // then
    expect(result).toContain("SUPERVISED TASK TIMED OUT")
    expect(cancelCalls).toHaveLength(1)
    expect(cancelCalls[0]?.taskId).toBe("bg_timeout_cleanup")
  })

  test("cancels launched task when parent aborts while waiting for session start", async () => {
    // given
    const { executeUnstableAgentTask } = require("./unstable-agent-task")
    const cancelCalls: Array<{ taskId: string; options?: Record<string, unknown> }> = []

    const mockManager = {
      launch: async () => ({ id: "bg_wait_abort", status: "pending" }),
      getTask: () => ({ id: "bg_wait_abort", status: "pending" }),
      cancelTask: async (taskId: string, options?: Record<string, unknown>) => {
        cancelCalls.push({ taskId, options })
        return true
      },
    }

    // when
    const result = await executeUnstableAgentTask(
      createArgs(),
      createToolContext(true),
      {
        manager: mockManager,
        client: {
          session: {
            status: async () => ({ data: {} }),
            messages: async () => ({ data: [] }),
          },
        },
      },
      createParentContext(),
      "test-agent",
      undefined,
      undefined,
      "gpt-test"
    )

    // then
    expect(result).toContain("Task aborted while waiting for session to start.")
    expect(cancelCalls).toHaveLength(1)
    expect(cancelCalls[0]?.taskId).toBe("bg_wait_abort")
  })
})
