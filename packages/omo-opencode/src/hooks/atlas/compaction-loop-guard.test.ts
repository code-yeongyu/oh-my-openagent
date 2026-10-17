import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { createOpencodeClient } from "@opencode-ai/sdk"
import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { writeBoulderState } from "../../features/boulder-state"
import { _resetForTesting, registerAgentName } from "../../features/claude-code-session-state"
import { releaseAllPromptAsyncReservationsForTesting } from "../shared/prompt-async-gate"
import { createAtlasHook } from "./index"

const COMPACTION_TOOL_PAIR_400 = {
  name: "APIError",
  data: {
    message:
      "messages.2: `tool_use` ids were found without `tool_result` blocks immediately after: toolu_01PCXjcagoMAca32awicQHce. Each `tool_use` block must have a corresponding `tool_result` block in the next message.",
    statusCode: 400,
    isRetryable: false,
  },
}

const TOKEN_LIMIT_400 = {
  name: "APIError",
  data: {
    message: "prompt is too long: 250000 tokens > 200000 maximum",
    statusCode: 400,
    isRetryable: false,
  },
}

type MockAtlasInput = Parameters<typeof createAtlasHook>[0] & {
  _promptMock: ReturnType<typeof mock>
  _messagesMock: ReturnType<typeof mock>
}

describe("atlas boulder continuation compaction loop guard", () => {
  const SESSION_ID = "session-main-6303"
  let TEST_DIR = ""

  function createMockPluginInput(messagesData?: unknown[]): MockAtlasInput {
    const promptMock = mock(() => Promise.resolve())
    const messagesMock = mock(async () => ({ data: messagesData ?? [] }))
    const client = createOpencodeClient({ baseUrl: "http://localhost" })
    Reflect.set(client.session, "get", mock(async ({ path }: { path: { id: string } }) => ({
      data: { id: path.id, parentID: undefined },
    })))
    Reflect.set(client.session, "messages", messagesMock)
    Reflect.set(client.session, "prompt", promptMock)
    Reflect.set(client.session, "promptAsync", promptMock)

    return {
      directory: TEST_DIR,
      project: {} as Parameters<typeof createAtlasHook>[0]["project"],
      worktree: TEST_DIR,
      experimental_workspace: { register: () => {} },
      serverUrl: new URL("http://localhost"),
      $: {} as Parameters<typeof createAtlasHook>[0]["$"],
      client,
      _promptMock: promptMock,
      _messagesMock: messagesMock,
    }
  }

  function createTestAtlasHook(input = createMockPluginInput()) {
    return createAtlasHook(input, {
      directory: TEST_DIR,
      idleSettleMs: 0,
    })
  }

  function writeIncompleteBoulderPlan(): void {
    const planPath = join(TEST_DIR, "test-plan.md")
    writeFileSync(planPath, "# Plan\n- [ ] Task 1\n- [ ] Task 2")
    writeBoulderState(TEST_DIR, {
      active_plan: planPath,
      started_at: "2026-01-02T10:00:00Z",
      session_ids: [SESSION_ID],
      plan_name: "test-plan",
    })
  }

  beforeEach(() => {
    _resetForTesting()
    releaseAllPromptAsyncReservationsForTesting()
    registerAgentName("atlas")
    registerAgentName("sisyphus")
    TEST_DIR = join(tmpdir(), `atlas-compaction-loop-${randomUUID()}`)
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true })
    }
  })

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true })
    }
    _resetForTesting()
    releaseAllPromptAsyncReservationsForTesting()
  })

  test("#given incomplete boulder plan #when non-retryable compaction 400 session.error fires #then no continuation is injected and the following idle stays silent", async () => {
    // given
    writeIncompleteBoulderPlan()
    const mockInput = createMockPluginInput()
    const hook = createTestAtlasHook(mockInput)

    // when
    await hook.handler({
      event: {
        type: "session.error",
        properties: { sessionID: SESSION_ID, error: COMPACTION_TOOL_PAIR_400 },
      },
    })
    await hook.handler({
      event: { type: "session.idle", properties: { sessionID: SESSION_ID } },
    })

    // then
    expect(mockInput._promptMock).not.toHaveBeenCalled()
  })

  test("#given incomplete boulder plan #when token limit session.error fires #then no continuation is injected and the following idle stays silent", async () => {
    // given
    writeIncompleteBoulderPlan()
    const mockInput = createMockPluginInput()
    const hook = createTestAtlasHook(mockInput)

    // when
    await hook.handler({
      event: {
        type: "session.error",
        properties: { sessionID: SESSION_ID, error: TOKEN_LIMIT_400 },
      },
    })
    await hook.handler({
      event: { type: "session.idle", properties: { sessionID: SESSION_ID } },
    })

    // then
    expect(mockInput._promptMock).not.toHaveBeenCalled()
  })

  test("#given latest persisted message is an errored compaction marker #when idle fires #then no continuation is injected", async () => {
    // given
    writeIncompleteBoulderPlan()
    const mockInput = createMockPluginInput([
      {
        info: {
          id: "m1",
          role: "user",
          agent: "atlas",
          time: { created: 1, completed: 2 },
        },
        parts: [{ type: "text", text: "continue" }],
      },
      {
        info: {
          id: "m2",
          role: "assistant",
          agent: "compaction",
          error: COMPACTION_TOOL_PAIR_400,
          time: { created: 3, completed: 4 },
        },
        parts: [],
      },
    ])
    const hook = createTestAtlasHook(mockInput)

    // when
    await hook.handler({
      event: { type: "session.idle", properties: { sessionID: SESSION_ID } },
    })

    // then
    expect(mockInput._promptMock).not.toHaveBeenCalled()
  })

  test("#given a transient runtime error #when session.error fires #then immediate retry injection is preserved", async () => {
    // given
    writeIncompleteBoulderPlan()
    const mockInput = createMockPluginInput()
    const hook = createTestAtlasHook(mockInput)

    // when
    await hook.handler({
      event: {
        type: "session.error",
        properties: { sessionID: SESSION_ID, error: { name: "RuntimeError", message: "provider overloaded" } },
      },
    })

    // then
    expect(mockInput._promptMock).toHaveBeenCalledTimes(1)
  })

  test("#given continuation stalled by unrecoverable error #when a genuine user message arrives #then idle can resume continuation", async () => {
    // given
    writeIncompleteBoulderPlan()
    const originalDateNow = Date.now
    let now = 1_000
    Date.now = () => now

    try {
      const mockInput = createMockPluginInput()
      const hook = createTestAtlasHook(mockInput)

      await hook.handler({
        event: {
          type: "session.error",
          properties: { sessionID: SESSION_ID, error: COMPACTION_TOOL_PAIR_400 },
        },
      })
      expect(mockInput._promptMock).not.toHaveBeenCalled()

      // when - user intervenes with a real message, then goes idle later
      await hook.handler({
        event: {
          type: "message.updated",
          properties: { info: { id: "mu1", sessionID: SESSION_ID, role: "user" }, parts: [{ type: "text", text: "manual fix applied" }] },
        },
      })
      now = 60_000
      await hook.handler({
        event: { type: "session.idle", properties: { sessionID: SESSION_ID } },
      })

      // then - continuation may resume after manual intervention
      expect(mockInput._promptMock).toHaveBeenCalledTimes(1)
    } finally {
      Date.now = originalDateNow
    }
  })

  test("#given continuation stalled by unrecoverable error #when an internal synthetic user message arrives #then the stall is not lifted", async () => {
    // given
    writeIncompleteBoulderPlan()
    const originalDateNow = Date.now
    let now = 1_000
    Date.now = () => now

    try {
      const mockInput = createMockPluginInput()
      const hook = createTestAtlasHook(mockInput)

      await hook.handler({
        event: {
          type: "session.error",
          properties: { sessionID: SESSION_ID, error: COMPACTION_TOOL_PAIR_400 },
        },
      })

      // when - an internal/synthetic user message lands on the session
      await hook.handler({
        event: {
          type: "message.updated",
          properties: {
            info: { id: "mu2", sessionID: SESSION_ID, role: "user" },
            parts: [{ type: "text", text: "internal continuation echo", synthetic: true }],
          },
        },
      })
      now = 60_000
      await hook.handler({
        event: { type: "session.idle", properties: { sessionID: SESSION_ID } },
      })

      // then - internal messages must not resume a stalled boulder
      expect(mockInput._promptMock).not.toHaveBeenCalled()
    } finally {
      Date.now = originalDateNow
    }
  })
})
