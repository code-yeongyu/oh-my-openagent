/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"
import { createOpencodeClient, type Project } from "@opencode-ai/sdk"

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

const { createToolExecuteAfterHandler } = await import("./tool-execute-after")

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

  function createHandler() {
    const project = {
      id: "project-1",
      worktree: testDirectory,
      time: {
        created: Date.now(),
      },
    } satisfies Project

    const ctx = {
      client: createOpencodeClient(),
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
  })
})
