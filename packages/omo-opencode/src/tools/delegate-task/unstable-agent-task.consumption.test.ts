/// <reference types="bun-types" />

// Task 1 (RED lock): pin the gap where executeUnstableAgentTask (the supervised
// "sync-looking" path, run_in_background=false forced to background mode) returns
// a completed result INLINE but never records background-output consumption for it.
//
// unstable-agent-task.ts drives BackgroundManager.launch + monitors to completion +
// returns "SUPERVISED TASK COMPLETED SUCCESSFULLY" inline, but it has NO call to
// recordBackgroundOutputConsumption. Because it does not touch the message cursor
// either, consumption is observed via the same cursor-restore-on-undo mechanism used
// by create-background-output.undo.test.ts:
//   1. supervised run returns the inline result (today: records nothing)
//   2. a normal background_output consume advances the cursor to the end
//   3. undo the PARENT message (the supervised turn's message) -> restore is a no-op
//      today (no snapshot exists for it)
//   4. a subsequent normal call returns "(No new output since last check)"
// After the fix, the supervised path records consumption so step 3 restores the
// cursor and step 4 returns the result again. Asserting step 4 contains the result
// FAILS today (RED).

import type { ToolContext } from "@opencode-ai/plugin/tool"
import type { BackgroundTask } from "../../features/background-agent"
import { createEventHandler } from "../../plugin/event"
import { clearBackgroundOutputConsumptionState } from "../../shared/background-output-consumption"
import { resetMessageCursor } from "../../shared/session-cursor"
import { releaseAllPromptAsyncReservationsForTesting } from "../../shared/prompt-async-gate"
import { __resetModelCache } from "../../shared/model-availability"
import { clearSkillCache } from "../../features/opencode-skill-loader/skill-content"
import { __setTimingConfig, __resetTimingConfig } from "./timing"
import * as connectedProvidersCache from "../../shared/connected-providers-cache"

declare const require: NodeJS.Require

const { describe, test, expect, beforeEach, afterEach, spyOn } = require("bun:test") as typeof import("bun:test")

const runtimeRequire = require as NodeJS.Require & { cache?: Record<string, unknown> }

function clearRequireCache(modulePath: string): void {
  const resolvedPath = runtimeRequire.resolve(modulePath)
  if (runtimeRequire.cache?.[resolvedPath]) {
    delete runtimeRequire.cache?.[resolvedPath]
  }
}

const SYSTEM_DEFAULT_MODEL = "anthropic/claude-sonnet-4-6"
const parentSessionID = "parent-session"
const taskSessionID = "ses_supervised_consumed"

let cacheSpy: ReturnType<typeof spyOn>
let providerModelsSpy: ReturnType<typeof spyOn>

type ToolContextWithCallID = ToolContext & {
  callID: string
}

const projectDir = "/Users/yeongyu/local-workspaces/oh-my-opencode"

const baseToolContext = {
  sessionID: parentSessionID,
  messageID: "parent-message",
  agent: "sisyphus",
  directory: projectDir,
  worktree: projectDir,
  abort: new AbortController().signal,
  metadata: () => {},
  ask: async () => {},
} as const satisfies Partial<ToolContextWithCallID>

beforeEach(() => {
  clearRequireCache("./tools")
  __resetModelCache()
  clearSkillCache()
  __setTimingConfig({
    POLL_INTERVAL_MS: 10,
    MIN_STABILITY_TIME_MS: 50,
    STABILITY_POLLS_REQUIRED: 1,
    WAIT_FOR_SESSION_INTERVAL_MS: 10,
    WAIT_FOR_SESSION_TIMEOUT_MS: 1000,
    MAX_POLL_TIME_MS: 50,
    SESSION_CONTINUATION_STABILITY_MS: 50,
  })
  cacheSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(["anthropic", "google", "openai"])
  providerModelsSpy = spyOn(connectedProvidersCache, "readProviderModelsCache").mockReturnValue({
    models: {
      anthropic: ["claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5"],
      google: ["gemini-3.1-pro", "gemini-3-flash"],
      openai: ["gpt-5.5", "gpt-5.4-mini", "gpt-5.5"],
    },
    connected: ["anthropic", "google", "openai"],
    updatedAt: "2026-01-01T00:00:00.000Z",
  })
})

afterEach(() => {
  __resetTimingConfig()
  releaseAllPromptAsyncReservationsForTesting()
  resetMessageCursor(taskSessionID)
  clearBackgroundOutputConsumptionState()
  cacheSpy?.mockRestore()
  providerModelsSpy?.mockRestore()
})

describe("supervised (unstable agent) inline completion records consumption", () => {
  test("#given a supervised run_in_background=false task that completes inline #when its parent message is undone after a normal consume #then the result is consumable again (consumption was recorded)", async () => {
    // #given - a gemini (unstable) category forced into supervised background mode
    const { createDelegateTask } = require("./tools")
    const launchedTask: BackgroundTask = {
      id: "task-supervised",
      sessionId: taskSessionID,
      parentSessionId: parentSessionID,
      parentMessageId: "parent-message",
      description: "Supervised unstable task",
      prompt: "Do something visual",
      agent: "sisyphus-junior",
      status: "running",
      startedAt: new Date(),
    }
    const supervisedManager = {
      launch: async () => launchedTask,
      getTask: () => launchedTask,
    }
    const supervisedClient = {
      app: { agents: async () => ({ data: [] }) },
      config: { get: async () => ({ data: { model: SYSTEM_DEFAULT_MODEL } }) },
      model: { list: async () => [{ provider: "google", id: "gemini-3.1-pro" }] },
      session: {
        get: async () => ({ data: { directory: projectDir } }),
        create: async () => ({ data: { id: taskSessionID } }),
        prompt: async () => ({ data: {} }),
        promptAsync: async () => ({ data: {} }),
        messages: async () => ({
          data: [
            {
              info: { role: "assistant", time: { created: Date.now() } },
              parts: [{ type: "text", text: "Supervised task result text" }],
            },
          ],
        }),
        status: async () => ({ data: { [taskSessionID]: { type: "idle" } } }),
      },
    }

    const delegateTool = createDelegateTask({ manager: supervisedManager, client: supervisedClient })

    // #when - supervised run returns the inline result
    const supervisedResult = await delegateTool.execute(
      {
        description: "Test supervised inline consumption",
        prompt: "Do something visual",
        category: "visual-engineering",
        run_in_background: false,
        load_skills: ["git-master"],
      },
      { ...baseToolContext, callID: "call-supervised" } as ToolContextWithCallID
    )

    // #then - it did complete inline via the supervised background path
    expect(supervisedResult).toContain("SUPERVISED TASK COMPLETED")

    // #given - mark the task terminal (completed) for the background_output completed branch
    // (mock manager never advances status; real supervised path mutates it via the manager)
    launchedTask.status = "completed"
    launchedTask.completedAt = new Date()

    const { createBackgroundOutput } = require("../background-task/create-background-output")
    const bgManager = { getTask: (id: string) => (id === launchedTask.id ? launchedTask : undefined) }
    const bgClient = {
      session: {
        messages: async () => ({
          data: [
            {
              id: "m1",
              info: { role: "assistant", time: "2026-01-01T00:00:00Z" },
              parts: [{ type: "text", text: "background output result" }],
            },
          ],
        }),
      },
    }
    const bgTool = createBackgroundOutput(bgManager, bgClient)
    const eventHandler = createEventHandler({
      ctx: {} as never,
      pluginConfig: {} as never,
      firstMessageVariantGate: {
        markSessionCreated: () => {},
        clear: () => {},
      },
      managers: {
        skillMcpManager: { disconnectSession: async () => {} },
        tmuxSessionManager: {
          onSessionCreated: async () => {},
          onSessionDeleted: async () => {},
        },
      } as never,
      hooks: {} as never,
    })

    // #when - a normal consume advances the cursor to the end of the transcript
    const firstConsume = await bgTool.execute(
      { task_id: launchedTask.id },
      { ...baseToolContext, callID: "call-bg-1", messageID: "msg-bg-1" } as ToolContextWithCallID
    )

    // the supervised turn's parent message is undone -> restore only has an effect if
    // the supervised path recorded a consumption snapshot for it
    await eventHandler({
      event: {
        type: "message.removed",
        properties: {
          sessionID: parentSessionID,
          messageID: "parent-message",
        },
      },
    })

    const redriveConsume = await bgTool.execute(
      { task_id: launchedTask.id },
      { ...baseToolContext, callID: "call-bg-2", messageID: "msg-bg-2" } as ToolContextWithCallID
    )

    // #then - the normal consume returned the result (cursor advanced)
    expect(firstConsume).toContain("background output result")
    // RED today: the supervised path recorded nothing, so undoing the parent message
    // does not restore the cursor and this returns "No new output since last check".
    // After the fix, the supervised inline success records consumption, the undo
    // restores the cursor, and the result is consumable again.
    expect(redriveConsume).toContain("background output result")
    expect(redriveConsume).not.toContain("No new output since last check")
  }, { timeout: 20000 })
})
