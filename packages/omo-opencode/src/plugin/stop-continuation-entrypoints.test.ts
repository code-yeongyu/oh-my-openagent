import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { unsafeTestValue } from "../../../../test-support/unsafe-test-value"
import type { OhMyOpenCodeConfig } from "../config"
import {
  createBoulderState,
  readBoulderState,
  writeBoulderState,
} from "../features/boulder-state"
import type { PluginContext } from "./types"
import { createChatMessageHandler } from "./chat-message"
import { createCommandExecuteBeforeHandler } from "./command-execute-before"
import { createToolExecuteBeforeHandler } from "./tool-execute-before"

type StopCalls = {
  readonly stoppedSessions: string[]
  readonly cancelledCountdowns: string[]
  readonly clearedGoals: string[]
}

function createStopHooks(): {
  readonly calls: StopCalls
  readonly hooks: Record<string, unknown>
} {
  const calls: StopCalls = {
    stoppedSessions: [],
    cancelledCountdowns: [],
    clearedGoals: [],
  }

  return {
    calls,
    hooks: {
      stopContinuationGuard: {
        "chat.message": async () => {},
        stop: (sessionID: string) => calls.stoppedSessions.push(sessionID),
        isStopped: () => false,
        clear: () => {},
      },
      todoContinuationEnforcer: {
        cancelAllCountdowns: () => calls.cancelledCountdowns.push("cancelled"),
      },
      goal: {
        setGoal: () => ({ id: "goal-id", status: "active", objective: "" }),
        getGoal: () => null,
        pauseGoal: () => null,
        resumeGoal: () => null,
        clearGoal: (sessionID: string) => {
          calls.clearedGoals.push(sessionID)
          return true
        },
        markComplete: () => null,
        event: async () => {},
      },
    },
  }
}

describe("stop continuation entrypoints", () => {
  let testDirectory = ""

  beforeEach(() => {
    testDirectory = join(tmpdir(), `stop-continuation-entrypoints-${randomUUID()}`)
    mkdirSync(testDirectory, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDirectory, { recursive: true, force: true })
  })

  function seedBoulderState(): void {
    writeBoulderState(
      testDirectory,
      createBoulderState(join(testDirectory, "plan.md"), "ses-stop", "atlas"),
    )
  }

  test("#given active continuations #when native /stop-continuation executes #then every mechanism stops", async () => {
    // given
    const { calls, hooks } = createStopHooks()
    seedBoulderState()
    const handler = createCommandExecuteBeforeHandler(unsafeTestValue({
      hooks,
      directory: testDirectory,
    }))

    // when
    await handler(
      { command: "stop-continuation", sessionID: "ses-stop", arguments: "" },
      { parts: [] },
    )

    // then
    expect(calls.stoppedSessions).toEqual(["ses-stop"])
    expect(calls.cancelledCountdowns).toEqual(["cancelled"])
    expect(calls.clearedGoals).toEqual(["ses-stop"])
    expect(readBoulderState(testDirectory)).toBeNull()
  })

  test("#given native expansion is unavailable #when raw /stop-continuation reaches chat.message #then every mechanism stops", async () => {
    // given
    const { calls, hooks } = createStopHooks()
    seedBoulderState()
    const handler = createChatMessageHandler({
      ctx: unsafeTestValue<PluginContext>({
        directory: testDirectory,
        client: { tui: { showToast: async () => {} } },
      }),
      pluginConfig: unsafeTestValue<OhMyOpenCodeConfig>({}),
      firstMessageVariantGate: {
        shouldOverride: () => false,
        markApplied: () => {},
      },
      hooks: unsafeTestValue(hooks),
    })

    // when
    await handler(
      { sessionID: "ses-stop", agent: "atlas" },
      {
        message: {},
        parts: [
          { type: "text", text: "internal context", synthetic: true },
          { type: "text", text: "/stop-continuation" },
        ],
      },
    )

    // then
    expect(calls.stoppedSessions).toEqual(["ses-stop"])
    expect(calls.cancelledCountdowns).toEqual(["cancelled"])
    expect(calls.clearedGoals).toEqual(["ses-stop"])
    expect(readBoulderState(testDirectory)).toBeNull()
  })

  test("#given ordinary text #when it mentions /stop-continuation inside a code block #then continuations stay active", async () => {
    // given
    const { calls, hooks } = createStopHooks()
    seedBoulderState()
    const handler = createChatMessageHandler({
      ctx: unsafeTestValue<PluginContext>({
        directory: testDirectory,
        client: { tui: { showToast: async () => {} } },
      }),
      pluginConfig: unsafeTestValue<OhMyOpenCodeConfig>({}),
      firstMessageVariantGate: {
        shouldOverride: () => false,
        markApplied: () => {},
      },
      hooks: unsafeTestValue(hooks),
    })

    // when
    await handler(
      { sessionID: "ses-stop", agent: "atlas" },
      {
        message: {},
        parts: [{ type: "text", text: "Explain ```/stop-continuation``` without running it." }],
      },
    )

    // then
    expect(calls.stoppedSessions).toHaveLength(0)
    expect(calls.cancelledCountdowns).toHaveLength(0)
    expect(calls.clearedGoals).toHaveLength(0)
    expect(readBoulderState(testDirectory)).not.toBeNull()
  })

  test("#given the skill tool entrypoint #when stop-continuation runs #then existing behavior remains intact", async () => {
    // given
    const { calls, hooks } = createStopHooks()
    seedBoulderState()
    const handler = createToolExecuteBeforeHandler({
      ctx: unsafeTestValue<PluginContext>({ directory: testDirectory, client: {} }),
      hooks: unsafeTestValue(hooks),
    })

    // when
    await handler(
      { tool: "skill", sessionID: "ses-stop", callID: "call-stop" },
      { args: { name: "stop-continuation" } },
    )

    // then
    expect(calls.stoppedSessions).toEqual(["ses-stop"])
    expect(calls.cancelledCountdowns).toEqual(["cancelled"])
    expect(calls.clearedGoals).toEqual(["ses-stop"])
    expect(readBoulderState(testDirectory)).toBeNull()
  })
})
