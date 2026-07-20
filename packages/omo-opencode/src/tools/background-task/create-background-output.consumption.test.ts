/// <reference types="bun-types" />

// Task 1 (RED lock): pin the gap where background_output(task_id, full_session=true)
// on a COMPLETED task does NOT record consumption. Today only the non-full_session
// completed branch calls recordBackgroundOutputConsumption (create-background-output.ts
// completed branch); the full_session branch returns early without recording.
//
// The recording is observed indirectly through the cursor-restore-on-undo mechanism
// (same mechanism proven by create-background-output.undo.test.ts):
//   1. full_session call (does NOT record today)
//   2. a normal call advances the message cursor to the end
//   3. undo the full_session message -> restoreBackgroundOutputConsumption is a no-op
//      today (no snapshot exists) so the cursor stays at the end
//   4. a subsequent normal call therefore returns "(No new output since last check)"
// After the fix, step 3 restores the cursor and step 4 returns the result again.
// Asserting step 4 contains the result FAILS today (RED).

import { afterEach, describe, expect, test } from "bun:test"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import type { BackgroundTask } from "../../features/background-agent"
import { createEventHandler } from "../../plugin/event"
import { clearBackgroundOutputConsumptionState } from "../../shared/background-output-consumption"
import { resetMessageCursor } from "../../shared/session-cursor"
import type { BackgroundOutputClient, BackgroundOutputManager } from "./clients"
import { createBackgroundOutput } from "./create-background-output"

const projectDir = "/Users/yeongyu/local-workspaces/oh-my-opencode"

const parentSessionID = "parent-session"
const taskSessionID = "task-session"

type ToolContextWithCallID = ToolContext & {
  callID: string
}

const baseContext = {
  sessionID: parentSessionID,
  agent: "test-agent",
  directory: projectDir,
  worktree: projectDir,
  abort: new AbortController().signal,
  metadata: () => {},
  ask: async () => {},
  callID: "call-1",
} as const satisfies Partial<ToolContextWithCallID>

function createTask(overrides: Partial<BackgroundTask> = {}): BackgroundTask {
  return {
    id: "task-1",
    sessionId: taskSessionID,
    parentSessionId: parentSessionID,
    parentMessageId: "msg-parent",
    description: "background task",
    prompt: "do work",
    agent: "test-agent",
    status: "completed",
    ...overrides,
  }
}

function createMockClient(): BackgroundOutputClient {
  return {
    session: {
      messages: async () => ({
        data: [
          {
            id: "m1",
            info: { role: "assistant", time: "2026-01-01T00:00:00Z" },
            parts: [{ type: "text", text: "final result" }],
          },
        ],
      }),
    },
  }
}

function createMockEventHandler() {
  return createEventHandler({
    ctx: {} as never,
    pluginConfig: {} as never,
    firstMessageVariantGate: {
      markSessionCreated: () => {},
      clear: () => {},
    },
    managers: {
      skillMcpManager: {
        disconnectSession: async () => {},
      },
      tmuxSessionManager: {
        onSessionCreated: async () => {},
        onSessionDeleted: async () => {},
      },
    } as never,
    hooks: {} as never,
  })
}

afterEach(() => {
  resetMessageCursor(taskSessionID)
  clearBackgroundOutputConsumptionState()
})

describe("createBackgroundOutput full_session consumption recording", () => {
  test("#given a completed task read with full_session=true #when the full_session message is undone after a normal consume #then the result is consumable again (consumption was recorded)", async () => {
    // #given
    const task = createTask()
    const manager: BackgroundOutputManager = {
      getTask: id => (id === task.id ? task : undefined),
    }
    const tool = createBackgroundOutput(manager, createMockClient())
    const eventHandler = createMockEventHandler()

    // #when - full_session read of the completed task (today: records nothing)
    const fullSessionOutput = await tool.execute(
      { task_id: task.id, full_session: true },
      { ...baseContext, messageID: "msg-full-1" } as ToolContextWithCallID
    )

    // a later normal consume advances the cursor to the end of the transcript
    const normalOutput = await tool.execute(
      { task_id: task.id },
      { ...baseContext, callID: "call-2", messageID: "msg-result-1" } as ToolContextWithCallID
    )

    // the full_session message is undone -> restoreBackgroundOutputConsumption only
    // restores the cursor if the full_session branch recorded a snapshot
    await eventHandler({
      event: {
        type: "message.removed",
        properties: {
          sessionID: parentSessionID,
          messageID: "msg-full-1",
        },
      },
    })

    const redriveOutput = await tool.execute(
      { task_id: task.id },
      { ...baseContext, callID: "call-3", messageID: "msg-result-2" } as ToolContextWithCallID
    )

    // #then - the full_session read happened and was a completed success
    expect(fullSessionOutput).toContain("final result")
    // the normal consume returned the result (cursor advanced)
    expect(normalOutput).toContain("final result")
    // RED today: restore was a no-op (full_session branch recorded nothing), so the
    // cursor is still at the end and this returns "No new output since last check".
    // After the fix, the full_session branch records consumption, the undo restores
    // the cursor, and the result is consumable again.
    expect(redriveOutput).toContain("final result")
    expect(redriveOutput).not.toContain("No new output since last check")
  })
})
