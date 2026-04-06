/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, it, mock, afterAll, spyOn } from "bun:test"
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

describe("createToolExecuteAfterHandler background launch detection", () => {
  let testDirectory = ""

  beforeEach(() => {
    testDirectory = join(tmpdir(), `atlas-background-launch-${crypto.randomUUID()}`)

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
      time: {
        created: Date.now(),
      },
    }
  }

  function createSessionGetResult(parentID: string | undefined): SessionGetResult {
    return {
      data: {
        parentID,
      },
      error: undefined,
      request: new Request("https://example.com/session"),
      response: new Response(null, { status: 200 }),
    } as SessionGetResult
  }

  function createHandler(parentSessionIDs?: Record<string, string | undefined>) {
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

    const ctx = {
      client,
      project,
      directory: testDirectory,
      worktree: testDirectory,
      serverUrl: new URL("https://example.com"),
      $: Bun.$,
    } satisfies PluginInput

    return createToolExecuteAfterHandler({
      ctx,
      pendingFilePaths: new Map(),
      pendingTaskRefs: new Map(),
      autoCommit: true,
      getState: () => ({ promptFailureCount: 0 }),
    })
  }

  describe("#given a call_omo_agent background launch result", () => {
    describe("#when tool.execute.after handles it", () => {
      it("#then it should treat the launch as still running", async () => {
        const handler = createHandler()
        const output = {
          title: "call_omo_agent",
          output: "Background agent task launched successfully.",
          metadata: {
            sessionId: "ses_child123",
          },
        }

        await handler(
          {
            tool: "call_omo_agent",
            sessionID: "ses_parent",
          },
          output,
        )

        expect(output.output).toBe("Background agent task launched successfully.")
        expect(collectGitDiffStatsMock).not.toHaveBeenCalled()
      })
    })

    describe("#when a background task launch belongs to the active boulder task", () => {
      it("#then it should persist the delegated session without transforming the launch output", async () => {
        const sessionID = "ses_parent"
        const childSessionID = "ses_child123"
        const planPath = join(testDirectory, "background-launch-plan.md")
        const project = createProject()
        const client = {
          session: {
            get: async () => createSessionGetResult(undefined),
          },
        } as unknown as PluginInput["client"]

        spyOn(client.session, "get").mockImplementation((input) => Promise.resolve(
          createSessionGetResult(input?.path?.id === childSessionID ? sessionID : undefined),
        ) as never)

        writeFileSync(planPath, `# Plan

## TODOs
- [ ] 1. Implement auth flow
`)

        writeBoulderState(testDirectory, {
          active_plan: planPath,
          started_at: "2026-01-02T10:00:00Z",
          session_ids: [sessionID],
          plan_name: "background-launch-plan",
        })

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
        const beforeHandler = createToolExecuteBeforeHandler({ ctx, pendingFilePaths, pendingTaskRefs })
        const afterHandler = createToolExecuteAfterHandler({
          ctx,
          pendingFilePaths,
          pendingTaskRefs,
          autoCommit: true,
          getState: () => ({ promptFailureCount: 0 }),
        })

        await beforeHandler(
          { tool: "task", sessionID, callID: "call-bg-task" },
          { args: { prompt: "Implement auth flow" } },
        )

        const output = {
          title: "Sisyphus Task",
          output: "Background task launched.\n\nBackground Task ID: bg_123\n\n<task_metadata>\nsession_id: ses_child123\n</task_metadata>",
          metadata: {
            sessionId: childSessionID,
            agent: "sisyphus-junior",
            category: "deep",
          },
        }

        await afterHandler(
          { tool: "task", sessionID, callID: "call-bg-task" },
          output,
        )

        expect(output.output).toContain("Background task launched.")
        expect(collectGitDiffStatsMock).not.toHaveBeenCalled()
        expect(readBoulderState(testDirectory)?.session_ids).toContain(childSessionID)
        expect(readBoulderState(testDirectory)?.session_origins?.[childSessionID]).toBe("appended")
        expect(readBoulderState(testDirectory)?.task_sessions?.["todo:1"]?.session_id).toBe(childSessionID)
      })

      it("#then it should not track spawned child when child lookup fails", async () => {
        const sessionID = "ses_parent"
        const childSessionID = "ses_child_lookup_failure"
        const planPath = join(testDirectory, "background-launch-plan.md")
        const project = createProject()
        const client = {
          session: {
            get: async () => createSessionGetResult(undefined),
          },
        } as unknown as PluginInput["client"]

        spyOn(client.session, "get").mockImplementation((input) => {
          if (input?.path?.id === childSessionID) {
            return Promise.reject(new Error("lookup failed")) as never
          }
          return Promise.resolve(createSessionGetResult(undefined)) as never
        })

        writeFileSync(planPath, `# Plan

## TODOs
- [ ] 1. Implement auth flow
`)

        writeBoulderState(testDirectory, {
          active_plan: planPath,
          started_at: "2026-01-02T10:00:00Z",
          session_ids: [sessionID],
          plan_name: "background-launch-plan",
        })

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
        const beforeHandler = createToolExecuteBeforeHandler({ ctx, pendingFilePaths, pendingTaskRefs })
        const afterHandler = createToolExecuteAfterHandler({
          ctx,
          pendingFilePaths,
          pendingTaskRefs,
          autoCommit: true,
          getState: () => ({ promptFailureCount: 0 }),
        })

        await beforeHandler(
          { tool: "task", sessionID, callID: "call-bg-task-lookup-failure" },
          { args: { prompt: "Implement auth flow" } },
        )

        const output = {
          title: "Sisyphus Task",
          output: "Background task launched.\n\nBackground Task ID: bg_456\n\n<task_metadata>\nsession_id: ses_child_lookup_failure\n</task_metadata>",
          metadata: {
            sessionId: childSessionID,
            agent: "sisyphus-junior",
            category: "deep",
          },
        }

        await afterHandler(
          { tool: "task", sessionID, callID: "call-bg-task-lookup-failure" },
          output,
        )

        expect(readBoulderState(testDirectory)?.session_ids).not.toContain(childSessionID)
      })

      it("#then it should not track an extracted child session outside active lineage", async () => {
        const sessionID = "ses_parent"
        const childSessionID = "ses_outside_lineage"
        const planPath = join(testDirectory, "background-launch-plan.md")
        const project = createProject()
        const client = {
          session: {
            get: async () => createSessionGetResult(undefined),
          },
        } as unknown as PluginInput["client"]

        spyOn(client.session, "get").mockImplementation((input) => Promise.resolve(
          createSessionGetResult(input?.path?.id === childSessionID ? "ses_unrelated_parent" : undefined),
        ) as never)

        writeFileSync(planPath, `# Plan

## TODOs
- [ ] 1. Implement auth flow
`)

        writeBoulderState(testDirectory, {
          active_plan: planPath,
          started_at: "2026-01-02T10:00:00Z",
          session_ids: [sessionID],
          plan_name: "background-launch-plan",
        })

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
        const beforeHandler = createToolExecuteBeforeHandler({ ctx, pendingFilePaths, pendingTaskRefs })
        const afterHandler = createToolExecuteAfterHandler({
          ctx,
          pendingFilePaths,
          pendingTaskRefs,
          autoCommit: true,
          getState: () => ({ promptFailureCount: 0 }),
        })

        await beforeHandler(
          { tool: "task", sessionID, callID: "call-bg-task-outside-lineage" },
          { args: { prompt: "Implement auth flow" } },
        )

        const output = {
          title: "Sisyphus Task",
          output: "Background task launched.\n\nBackground Task ID: bg_789\n\n<task_metadata>\nsession_id: ses_outside_lineage\n</task_metadata>",
          metadata: {
            sessionId: childSessionID,
            agent: "sisyphus-junior",
            category: "deep",
          },
        }

        await afterHandler(
          { tool: "task", sessionID, callID: "call-bg-task-outside-lineage" },
          output,
        )

        expect(readBoulderState(testDirectory)?.session_ids).not.toContain(childSessionID)
      })

      it("#then it should not append an unrelated launcher session into active boulder", async () => {
        const sessionID = "ses_unrelated_parent"
        const childSessionID = "ses_unrelated_child"
        const planPath = join(testDirectory, "background-launch-plan.md")
        const project = createProject()
        const client = {
          session: {
            get: async () => createSessionGetResult(undefined),
          },
        } as unknown as PluginInput["client"]

        spyOn(client.session, "get").mockImplementation((input) => Promise.resolve(
          createSessionGetResult(input?.path?.id === childSessionID ? sessionID : undefined),
        ) as never)

        writeFileSync(planPath, `# Plan

## TODOs
- [ ] 1. Implement auth flow
`)

        writeBoulderState(testDirectory, {
          active_plan: planPath,
          started_at: "2026-01-02T10:00:00Z",
          session_ids: ["ses_boulder_root"],
          session_origins: { "ses_boulder_root": "direct" },
          plan_name: "background-launch-plan",
        })

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
        const beforeHandler = createToolExecuteBeforeHandler({ ctx, pendingFilePaths, pendingTaskRefs })
        const afterHandler = createToolExecuteAfterHandler({
          ctx,
          pendingFilePaths,
          pendingTaskRefs,
          autoCommit: true,
          getState: () => ({ promptFailureCount: 0 }),
        })

        await beforeHandler(
          { tool: "task", sessionID, callID: "call-bg-task-unrelated-launcher" },
          { args: { prompt: "Implement auth flow" } },
        )

        const output = {
          title: "Sisyphus Task",
          output: "Background task launched.\n\nBackground Task ID: bg_999\n\n<task_metadata>\nsession_id: ses_unrelated_child\n</task_metadata>",
          metadata: {
            sessionId: childSessionID,
            agent: "sisyphus-junior",
            category: "deep",
          },
        }

        await afterHandler(
          { tool: "task", sessionID, callID: "call-bg-task-unrelated-launcher" },
          output,
        )

        expect(readBoulderState(testDirectory)?.session_ids).not.toContain(sessionID)
        expect(readBoulderState(testDirectory)?.session_ids).not.toContain(childSessionID)
      })
    })
  })
})
