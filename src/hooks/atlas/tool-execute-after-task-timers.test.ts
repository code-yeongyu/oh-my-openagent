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
const formatFileChangesMock = mock(() => "No file changes")

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
    formatFileChangesMock.mockClear()
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
    } as PluginInput["client"]

    if (parentSessionIDs) {
      spyOn(client.session, "get").mockImplementation((input) => Promise.resolve(
        createSessionGetResult(parentSessionIDs[input?.path?.id ?? ""]),
      ) as never)
    }

    const pendingFilePaths = new Map<string, string>()
    const pendingTaskRefs = new Map()
    const pendingPlanSnapshots = new Map<string, string>()
    const ctx = {
      client,
      project,
      directory: testDirectory,
      worktree: testDirectory,
      serverUrl: new URL("https://example.com"),
      $: Bun.$,
    } satisfies PluginInput

    return {
      beforeHandler: createToolExecuteBeforeHandler({
        ctx,
        pendingFilePaths,
        pendingTaskRefs,
        pendingPlanSnapshots,
        isCallerOrchestrator: isCallerOrchestratorMock,
      }),
      afterHandler: createToolExecuteAfterHandler({
        ctx,
        pendingFilePaths,
        pendingTaskRefs,
        pendingPlanSnapshots,
        autoCommit: true,
        getState: () => ({ promptFailureCount: 0 }),
        isCallerOrchestrator: isCallerOrchestratorMock,
        collectGitDiffStats: collectGitDiffStatsMock as never,
        formatFileChanges: formatFileChangesMock as never,
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
    expect(typeof taskSession?.elapsed_ms).toBe("number")
  })

  it("ends task timer when plan checkbox flips to checked via edit tool", async () => {
    // given
    const parentSessionID = "ses_parent_3"
    const planDirectory = join(testDirectory, ".sisyphus", "plans")
    mkdirSync(planDirectory, { recursive: true })
    const planPath = join(planDirectory, "task-timer-edit-plan.md")
    writeFileSync(planPath, "# Plan\n\n## TODOs\n- [ ] 1. Implement auth flow\n", "utf-8")
    writeBoulderState(testDirectory, {
      schema_version: 2,
      active_work_id: "work-1",
      active_plan: planPath,
      started_at: "2026-01-02T10:00:00Z",
      session_ids: [parentSessionID],
      plan_name: "task-timer-edit-plan",
      task_sessions: {
        "todo:1": {
          task_key: "todo:1",
          task_label: "1",
          task_title: "Implement auth flow",
          session_id: "ses_child_3",
          started_at: "2026-01-02T10:00:00Z",
          status: "running",
          updated_at: "2026-01-02T10:00:00Z",
        },
      },
      works: {
        "work-1": {
          work_id: "work-1",
          active_plan: planPath,
          plan_name: "task-timer-edit-plan",
          started_at: "2026-01-02T10:00:00Z",
          session_ids: [parentSessionID],
          status: "active",
          task_sessions: {},
        },
      },
    })
    const { beforeHandler, afterHandler } = createHandlers()

    await beforeHandler(
      { tool: "edit", sessionID: parentSessionID, callID: "call-task-timer-edit-1" },
      { args: { filePath: planPath, oldString: "- [ ] 1. Implement auth flow", newString: "- [x] 1. Implement auth flow" } },
    )

    writeFileSync(planPath, "# Plan\n\n## TODOs\n- [x] 1. Implement auth flow\n", "utf-8")

    // when
    await afterHandler(
      { tool: "edit", sessionID: parentSessionID, callID: "call-task-timer-edit-1" },
      {
        title: "Edit",
        output: "Updated file",
        metadata: {
          filePath: planPath,
        },
      },
    )

    // then
    const taskSession = readBoulderState(testDirectory)?.works?.["work-1"]?.task_sessions?.["todo:1"]
    expect(taskSession).toBeDefined()
    expect(taskSession?.ended_at).toBeString()
    expect(taskSession?.status).toBe("completed")
    expect(typeof taskSession?.elapsed_ms).toBe("number")
    expect((taskSession?.elapsed_ms ?? 0) > 0).toBe(true)
  })

  it("tracks parallel delegated tasks by task label from TASK section", async () => {
    // given
    const parentSessionID = "ses_parent_parallel"
    const planPath = join(testDirectory, "task-timer-parallel-plan.md")
    writeFileSync(
      planPath,
      "# Plan\n\n## TODOs\n- [ ] 1. First task\n- [ ] 2. Add tests\n- [ ] 3. Write docs\n",
      "utf-8",
    )
    writeBoulderState(testDirectory, {
      schema_version: 2,
      active_work_id: "work-1",
      active_plan: planPath,
      started_at: "2026-01-02T10:00:00Z",
      session_ids: [parentSessionID],
      plan_name: "task-timer-parallel-plan",
      works: {
        "work-1": {
          work_id: "work-1",
          active_plan: planPath,
          plan_name: "task-timer-parallel-plan",
          started_at: "2026-01-02T10:00:00Z",
          session_ids: [parentSessionID],
          status: "active",
        },
      },
    })
    const { beforeHandler, afterHandler } = createHandlers({
      ses_child_parallel_2: parentSessionID,
      ses_child_parallel_3: parentSessionID,
    })

    await beforeHandler(
      { tool: "task", sessionID: parentSessionID, callID: "call-task-parallel-2" },
      {
        args: {
          prompt: "## 1. TASK\n- [ ] 2. Add tests\n\n## 2. CONTEXT\n...",
        },
      },
    )
    await beforeHandler(
      { tool: "task", sessionID: parentSessionID, callID: "call-task-parallel-3" },
      {
        args: {
          prompt: "## 1. TASK\n- [ ] 3. Write docs\n\n## 2. CONTEXT\n...",
        },
      },
    )

    // when
    await afterHandler(
      { tool: "task", sessionID: parentSessionID, callID: "call-task-parallel-2" },
      {
        title: "Sisyphus Task",
        output: "Task completed\n<task_metadata>\nsession_id: ses_child_parallel_2\n</task_metadata>",
        metadata: {
          sessionId: "ses_child_parallel_2",
          agent: "sisyphus-junior",
          category: "deep",
        },
      },
    )
    await afterHandler(
      { tool: "task", sessionID: parentSessionID, callID: "call-task-parallel-3" },
      {
        title: "Sisyphus Task",
        output: "Task completed\n<task_metadata>\nsession_id: ses_child_parallel_3\n</task_metadata>",
        metadata: {
          sessionId: "ses_child_parallel_3",
          agent: "sisyphus-junior",
          category: "deep",
        },
      },
    )

    // then
    const taskSessions = readBoulderState(testDirectory)?.works?.["work-1"]?.task_sessions
    expect(taskSessions?.["todo:2"]?.task_key).toBe("todo:2")
    expect(taskSessions?.["todo:3"]?.task_key).toBe("todo:3")
    expect(taskSessions?.["todo:1"]).toBeUndefined()
  })

  it("falls back to current top-level task when TASK section label is missing", async () => {
    // given
    const parentSessionID = "ses_parent_fallback"
    const childSessionID = "ses_child_fallback"
    const planPath = join(testDirectory, "task-timer-fallback-plan.md")
    writeFileSync(planPath, "# Plan\n\n## TODOs\n- [ ] 1. First task\n", "utf-8")
    writeBoulderState(testDirectory, {
      schema_version: 2,
      active_work_id: "work-1",
      active_plan: planPath,
      started_at: "2026-01-02T10:00:00Z",
      session_ids: [parentSessionID],
      plan_name: "task-timer-fallback-plan",
      works: {
        "work-1": {
          work_id: "work-1",
          active_plan: planPath,
          plan_name: "task-timer-fallback-plan",
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
      { tool: "task", sessionID: parentSessionID, callID: "call-task-fallback-1" },
      {
        args: {
          prompt: "No structured header in this prompt",
        },
      },
    )

    // when
    await afterHandler(
      { tool: "task", sessionID: parentSessionID, callID: "call-task-fallback-1" },
      {
        title: "Sisyphus Task",
        output: "Task completed\n<task_metadata>\nsession_id: ses_child_fallback\n</task_metadata>",
        metadata: {
          sessionId: childSessionID,
          agent: "sisyphus-junior",
          category: "deep",
        },
      },
    )

    // then
    const taskSessions = readBoulderState(testDirectory)?.works?.["work-1"]?.task_sessions
    expect(taskSessions?.["todo:1"]?.task_key).toBe("todo:1")
  })

})
