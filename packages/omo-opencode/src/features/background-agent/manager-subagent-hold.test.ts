/// <reference types="bun-types" />

import { tmpdir } from "node:os"
import { afterEach, describe, expect, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import { createBackgroundOutput } from "../../tools/background-task/create-background-output"
import type { BackgroundOutputClient } from "../../tools/background-task/clients"
import { releaseAllPromptAsyncReservationsForTesting } from "../../shared/prompt-async-gate"
import {
  _resetForTesting as resetClaudeCodeSessionState,
  setMainSession,
} from "../claude-code-session-state"
import { _resetTaskToastManagerForTesting } from "../task-toast-manager/manager"
import { BackgroundManager } from "./manager"
import { _resetForTesting as resetProcessCleanupState } from "./process-cleanup"
import { clearBackgroundTaskRegistryForTesting } from "./task-registry"
import { clearAllTurnHoldStateForTesting, markSubagentTypeInTurn } from "./subagent-turn-hold-state"
import type { LaunchInput } from "./types"

function createPluginInput(client: unknown, directory = tmpdir()): PluginInput {
  return { client, directory } as PluginInput
}

function createManager(directory = tmpdir(), config?: { taskCleanupDelayMs?: number }): BackgroundManager {
  const client = {
    session: {
      create: async () => ({ data: { id: "ses_child" }, error: null }),
      get: async () => ({ data: { directory }, error: null }),
      abort: async () => ({ data: {}, error: null }),
    },
  }
  return new BackgroundManager({ pluginContext: createPluginInput(client, directory), config })
}

function getPendingParentWakes(manager: BackgroundManager): Map<string, unknown> {
  const parentWakeNotifier = Reflect.get(manager, "parentWakeNotifier") as {
    getPendingParentWakes: () => Map<string, unknown>
  }
  return parentWakeNotifier.getPendingParentWakes()
}

function createBackgroundOutputClient(): BackgroundOutputClient {
  return {
    session: {
      messages: async () => ({ data: [] }),
    },
  }
}

function createOutputContext(): ToolContext & { callID: string } {
  return {
    sessionID: "ses_main",
    messageID: "msg_parent",
    agent: "sisyphus",
    directory: tmpdir(),
    worktree: tmpdir(),
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => {},
    callID: "call_1",
  }
}

function createInput(parentSessionId: string, agent: string, model?: LaunchInput["model"]): LaunchInput {
  return {
    parentSessionId,
    parentMessageId: "msg_parent",
    description: `${agent} task`,
    prompt: "gather context",
    agent,
    model,
  }
}

afterEach(() => {
  clearBackgroundTaskRegistryForTesting()
  releaseAllPromptAsyncReservationsForTesting()
  resetClaudeCodeSessionState()
  resetProcessCleanupState()
  clearAllTurnHoldStateForTesting()
  _resetTaskToastManagerForTesting()
})

describe("BackgroundManager main-session context hold", () => {
  test("holds main-session explore and librarian launches without starting them", async () => {
    setMainSession("ses_main")
    const manager = createManager()

    const explore = await manager.launch(createInput("ses_main", "explore", { providerID: "provider", modelID: "model" }))
    const librarian = await manager.launch(createInput("ses_main", "librarian", { providerID: "provider", modelID: "model" }))

    expect(explore.status).toBe("pending")
    expect(explore.sessionId).toBeUndefined()
    expect(librarian.status).toBe("pending")
    expect(librarian.sessionId).toBeUndefined()
    await manager.shutdown()
  })

  test("does not hold plan, non-main, or plan-session launches", async () => {
    setMainSession("ses_main")
    const manager = createManager()

    const plan = await manager.launch(createInput("ses_main", "plan"))
    const nonMainExplore = await manager.launch(createInput("ses_child", "explore"))
    const planSessionExplore = await manager.launch(createInput("ses_plan", "explore"))

    expect(plan.status).toBe("pending")
    expect(nonMainExplore.status).toBe("pending")
    expect(planSessionExplore.status).toBe("pending")
    await manager.shutdown()
  })

  test("drops held tasks when plan is recorded in the same turn", async () => {
    setMainSession("ses_main")
    const manager = createManager()
    const task = await manager.launch(createInput("ses_main", "explore"))

    markSubagentTypeInTurn("ses_main", "plan")
    await manager.dropHeldTasks("ses_main")

    expect(manager.getTask(task.id)?.status).toBe("cancelled")
    expect(manager.getTask(task.id)?.droppedReason).toBe("delegated_to_plan")
    await manager.shutdown()
  })

  test("retains a dropped pre-start task after scheduled removal", async () => {
    setMainSession("ses_main")
    const manager = createManager(tmpdir(), { taskCleanupDelayMs: 0 })
    const task = await manager.launch(createInput("ses_main", "explore"))

    await manager.dropHeldTasks("ses_main")
    await new Promise((resolve) => setTimeout(resolve, 0))
    const outputTool = createBackgroundOutput(manager, createBackgroundOutputClient())
    const output = await outputTool.execute({ task_id: task.id }, createOutputContext())

    expect(manager.getTask(task.id)?.droppedReason).toBe("delegated_to_plan")
    expect(output).toContain("This explore/librarian task was skipped")
    await manager.shutdown()
  })

  test("releases held tasks to the existing queue when no plan was recorded", async () => {
    setMainSession("ses_main")
    const manager = createManager()
    const task = await manager.launch(createInput("ses_main", "explore"))

    await manager.releaseHeldTasks("ses_main")

    expect(manager.getTask(task.id)?.status).toBe("pending")
    await manager.shutdown()
  })

  test("cleans held tasks when the parent session is deleted", async () => {
    setMainSession("ses_main")
    const manager = createManager()
    const task = await manager.launch(createInput("ses_main", "librarian"))

    manager.handleEvent({ type: "session.deleted", properties: { sessionID: "ses_main" } })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(manager.getTask(task.id)).toBeUndefined()
    await manager.shutdown()
  })

  test("deletes held tasks synchronously before a concurrent release can start them", async () => {
    setMainSession("ses_main")
    let childSessionCreates = 0
    const directory = tmpdir()
    const client = {
      session: {
        create: async () => {
          childSessionCreates += 1
          return { data: { id: "ses_child" }, error: null }
        },
        get: async () => ({ data: { directory }, error: null }),
        abort: async () => ({ data: {}, error: null }),
      },
    }
    const manager = new BackgroundManager({ pluginContext: createPluginInput(client, directory) })
    const task = await manager.launch(createInput("ses_main", "explore"))

    manager.handleEvent({ type: "session.deleted", properties: { sessionID: "ses_main" } })
    await manager.releaseHeldTasks("ses_main")
    await new Promise((resolve) => setTimeout(resolve, 0))

    const discardHeldTasks = Reflect.get(manager, "discardHeldTasksForSession")
    expect(typeof discardHeldTasks).toBe("function")
    if (typeof discardHeldTasks !== "function") throw new Error("discardHeldTasksForSession is not callable")
    expect(discardHeldTasks.call(manager, "ses_main")).toBeUndefined()
    expect(manager.getTask(task.id)).toBeUndefined()
    expect(childSessionCreates).toBe(0)
    await manager.shutdown()
  })

  test("suppresses parent wakes for session deletion but keeps ordinary cancellation notifications", async () => {
    const directory = tmpdir()
    const client = {
      session: {
        messages: async () => ({ data: [] }),
        status: async () => ({ data: { type: "idle" } }),
        abort: async () => ({ data: {}, error: null }),
      },
    }
    const deletedManager = new BackgroundManager({ pluginContext: createPluginInput(client, directory) })
    const deletedTask = await deletedManager.trackTask({
      taskId: "bg_deleted",
      sessionId: "ses_deleted_child",
      parentSessionId: "ses_deleted_parent",
      description: "deleted child",
      agent: "explore",
    })

    deletedManager.handleEvent({ type: "session.deleted", properties: { sessionID: "ses_deleted_parent" } })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(deletedManager.getTask(deletedTask.id)?.status).toBe("cancelled")
    expect(deletedManager.hasPendingParentWake("ses_deleted_parent")).toBe(false)
    expect(getPendingParentWakes(deletedManager).has("ses_deleted_parent")).toBe(false)

    const ordinaryManager = new BackgroundManager({ pluginContext: createPluginInput(client, directory) })
    const ordinaryTask = await ordinaryManager.trackTask({
      taskId: "bg_ordinary",
      sessionId: "ses_ordinary_child",
      parentSessionId: "ses_ordinary_parent",
      description: "ordinary child",
      agent: "explore",
    })

    await ordinaryManager.cancelTask(ordinaryTask.id, { abortSession: false })

    expect(ordinaryManager.hasPendingParentWake("ses_ordinary_parent")).toBe(true)
    expect(getPendingParentWakes(ordinaryManager).has("ses_ordinary_parent")).toBe(true)
    await deletedManager.shutdown()
    await ordinaryManager.shutdown()
  })
})
