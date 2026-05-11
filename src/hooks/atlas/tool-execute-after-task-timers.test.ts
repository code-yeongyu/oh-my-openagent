/// <reference types="bun-types" />

import { afterAll, afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"
import type { Project } from "@opencode-ai/sdk"
import { readBoulderState, writeBoulderState } from "../../features/boulder-state"
import { createToolExecuteBeforeHandler } from "./tool-execute-before"

const isCallerOrchestratorMock = mock(async () => true)
const collectGitDiffStatsMock = mock(() => ({
  filesChanged: 0,
  insertions: 0,
  deletions: 0,
}))

mock.module("../../shared/session-utils", () => ({
  isCallerOrchestrator: isCallerOrchestratorMock,
}))

mock.module("../../shared/git-worktree", () => ({
  collectGitDiffStats: collectGitDiffStatsMock,
  formatFileChanges: mock(() => "No file changes"),
}))

afterAll(() => { mock.restore() })

const { createToolExecuteAfterHandler } = await import("./tool-execute-after")

type SessionGetInput = { path: { id: string } }
type SessionGetResult = {
  data: { parentID: string | undefined }
  error?: undefined
  request: Request
  response: Response
}

describe("createToolExecuteAfterHandler task timers", () => {
  let testDirectory = ""

  beforeEach(() => {
    testDirectory = join(tmpdir(), `atlas-task-timers-${crypto.randomUUID()}`)
    if (!existsSync(testDirectory)) {
      mkdirSync(testDirectory, { recursive: true })
    }
    isCallerOrchestratorMock.mockClear()
    collectGitDiffStatsMock.mockClear()
  })

  afterEach(() => {
    if (testDirectory && existsSync(testDirectory)) {
      rmSync(testDirectory, { recursive: true, force: true })
    }
  })

  function createProject(): Project {
    return {
      id: "project-1",
      worktree: testDirectory,
      time: { created: Date.now() },
    }
  }

  function createSessionGetResult(parentID: string | undefined): SessionGetResult {
    return {
      data: { parentID },
      error: undefined,
      request: new Request("https://example.com/session"),
      response: new Response(null, { status: 200 }),
    } as SessionGetResult
  }

  function createHandlers(parentSessionIDs?: Record<string, string | undefined>) {
    const project = createProject()
    const client = {
      session: {
        get: async (input: SessionGetInput) => createSessionGetResult(parentSessionIDs?.[input.path.id]),
      },
    } as unknown as PluginInput["client"]

    if (parentSessionIDs) {
      spyOn(client.session, "get").mockImplementation((input) => Promise.resolve(
        createSessionGetResult(parentSessionIDs[input?.path?.id ?? ""]),
      ) as never)
    }

    const pendingFilePaths = new Map<string, string>()
    const pendingTaskRefs = new Map()
    const ctx = {
      client,
      project,
      directory: testDirectory,
      worktree: testDirectory,
      serverUrl: new URL("https://example.com"),
      $: Bun.$,
    } satisfies PluginInput

    return {
      beforeHandler: createToolExecuteBeforeHandler({ ctx, pendingFilePaths, pendingTaskRefs }),
      afterHandler: createToolExecuteAfterHandler({
        ctx,
        pendingFilePaths,
        pendingTaskRefs,
        autoCommit: true,
        getState: () => ({ promptFailureCount: 0 }),
      }),
    }
  }

  it("starts task timer for todo:1 when delegated task session is tracked", async () => {
    // given
    const parentSessionID = "ses_parent"
    const childSessionID = "ses_child"
    const planPath = join(testDirectory, "task-timer-plan.md")
    writeFileSync(planPath, "# Plan\n\n## TODOs\n- [ ] 1. Implement auth flow\n", "utf-8")
    writeBoulderState(testDirectory, {
      schema_version: 2,
      active_work_id: "work-1",
      active_plan: planPath,
      started_at: "2026-01-02T10:00:00Z",
      session_ids: [parentSessionID],
      plan_name: "task-timer-plan",
      works: {
        "work-1": {
          work_id: "work-1",
          active_plan: planPath,
          plan_name: "task-timer-plan",
          started_at: "2026-01-02T10:00:00Z",
          session_ids: [parentSessionID],
          status: "active",
        },
      },
    })
    const { beforeHandler, afterHandler } = createHandlers({
      [childSessionID]: parentSessionID,
    })

    await beforeHandler(
      { tool: "task", sessionID: parentSessionID, callID: "call-task-timer-1" },
      { args: { prompt: "Implement auth flow" } },
    )

    // when
    await afterHandler(
      { tool: "task", sessionID: parentSessionID, callID: "call-task-timer-1" },
      {
        title: "Sisyphus Task",
        output: "Task completed\n<task_metadata>\nsession_id: ses_child\n</task_metadata>",
        metadata: {
          sessionId: childSessionID,
          agent: "sisyphus-junior",
          category: "deep",
        },
      },
    )

    // then
    const taskSession = readBoulderState(testDirectory)?.works?.["work-1"]?.task_sessions?.["todo:1"]
    expect(taskSession).toBeDefined()
    expect(taskSession?.started_at).toBeString()
    expect(taskSession?.status).toBe("running")
    expect(taskSession?.session_id).toBe(childSessionID)
  })

  it("ends task timer when todo:1 checkbox transitions to checked", async () => {
    // given
    const parentSessionID = "ses_parent_2"
    const childSessionID = "ses_child_2"
    const planPath = join(testDirectory, "task-timer-complete-plan.md")
    writeFileSync(planPath, "# Plan\n\n## TODOs\n- [ ] 1. Implement auth flow\n", "utf-8")
    writeBoulderState(testDirectory, {
      schema_version: 2,
      active_work_id: "work-1",
      active_plan: planPath,
      started_at: "2026-01-02T10:00:00Z",
      session_ids: [parentSessionID],
      plan_name: "task-timer-complete-plan",
      works: {
        "work-1": {
          work_id: "work-1",
          active_plan: planPath,
          plan_name: "task-timer-complete-plan",
          started_at: "2026-01-02T10:00:00Z",
          session_ids: [parentSessionID],
          status: "active",
        },
      },
    })
    const { beforeHandler, afterHandler } = createHandlers({
      [childSessionID]: parentSessionID,
    })

    await beforeHandler(
      { tool: "task", sessionID: parentSessionID, callID: "call-task-timer-2" },
      { args: { prompt: "Implement auth flow" } },
    )
    writeFileSync(planPath, "# Plan\n\n## TODOs\n- [x] 1. Implement auth flow\n", "utf-8")

    // when
    await afterHandler(
      { tool: "task", sessionID: parentSessionID, callID: "call-task-timer-2" },
      {
        title: "Sisyphus Task",
        output: "Task completed\n<task_metadata>\nsession_id: ses_child_2\n</task_metadata>",
        metadata: {
          sessionId: childSessionID,
          agent: "sisyphus-junior",
          category: "deep",
        },
      },
    )

    // then
    const taskSession = readBoulderState(testDirectory)?.works?.["work-1"]?.task_sessions?.["todo:1"]
    expect(taskSession).toBeDefined()
    expect(taskSession?.ended_at).toBeString()
    expect(taskSession?.status).toBe("completed")
    expect((taskSession?.elapsed_ms ?? 0) > 0).toBe(true)
  })
})
