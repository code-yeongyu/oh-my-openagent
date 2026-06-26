import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"
import { createOpencodeClient } from "@opencode-ai/sdk"
import type { Project } from "@opencode-ai/sdk"
import { writeBoulderState } from "../../features/boulder-state"
import { createToolExecuteAfterHandler } from "./tool-execute-after"
import type { SessionState } from "./types"

type SessionGetInput = { readonly path: { readonly id: string } }
type SessionGetResult = {
  readonly data: { readonly parentID: string | undefined }
  readonly error?: undefined
  readonly request: Request
  readonly response: Response
}

describe("createToolExecuteAfterHandler reminder compression", () => {
  const parentSessionID = "ses_parent_compression"
  let testDirectory = ""
  let sessionState: SessionState

  beforeEach(() => {
    testDirectory = join(tmpdir(), `atlas-reminder-compression-${crypto.randomUUID()}`)
    mkdirSync(testDirectory, { recursive: true })
    sessionState = { promptFailureCount: 0 }
  })

  afterEach(() => {
    if (existsSync(testDirectory)) {
      rmSync(testDirectory, { recursive: true, force: true })
    }
    mock.restore()
  })

  function createProject(): Project {
    return {
      id: "project-1",
      worktree: testDirectory,
      time: { created: 0 },
    }
  }

  function createSessionGetResult(parentID: string | undefined): SessionGetResult {
    return {
      data: { parentID },
      error: undefined,
      request: new Request("https://example.com/session"),
      response: new Response(null, { status: 200 }),
    }
  }

  function createPluginInput(): PluginInput {
    const client = createOpencodeClient({ baseUrl: "https://example.com" })
    const sessionGet = mock(async (input: SessionGetInput): Promise<SessionGetResult> => (
      createSessionGetResult(input.path.id.startsWith("ses_child_") ? parentSessionID : undefined)
    ))
    Reflect.set(client.session, "get", sessionGet)

    return {
      client,
      project: createProject(),
      directory: testDirectory,
      worktree: testDirectory,
      experimental_workspace: { register: () => {} },
      serverUrl: new URL("https://example.com"),
      $: Bun.$,
    }
  }

  it("keeps the first verification reminder full and compresses later boulder completions", async () => {
    // given
    const planPath = join(testDirectory, "compression-plan.md")
    writeFileSync(planPath, "# Plan\n\n## TODOs\n- [ ] 1. Implement auth flow\n- [ ] 2. Add validation\n", "utf-8")
    writeBoulderState(testDirectory, {
      active_plan: planPath,
      started_at: "2026-01-02T10:00:00Z",
      session_ids: [parentSessionID],
      plan_name: "compression-plan",
    })

    const collectGitDiffStats = mock(() => [])
    const formatFileChanges = mock(() => "[FILE CHANGES SUMMARY]\nNo file changes detected.\n")
    const handler = createToolExecuteAfterHandler({
      ctx: createPluginInput(),
      pendingFilePaths: new Map(),
      pendingTaskRefs: new Map(),
      autoCommit: true,
      getState: () => sessionState,
      isCallerOrchestrator: async () => true,
      collectGitDiffStats,
      formatFileChanges,
    })

    const firstOutput = {
      title: "Sisyphus Task",
      output: "First task completed",
      metadata: { sessionId: "ses_child_first" },
    }
    const secondOutput = {
      title: "Sisyphus Task",
      output: "Second task completed",
      metadata: { sessionId: "ses_child_second" },
    }

    // when
    await handler({ tool: "task", sessionID: parentSessionID }, firstOutput)
    await handler({ tool: "task", sessionID: parentSessionID }, secondOutput)

    // then
    expect(firstOutput.output).toContain("PHASE 1: READ THE CODE FIRST")
    expect(secondOutput.output).not.toContain("PHASE 1: READ THE CODE FIRST")
    expect(secondOutput.output).toContain("Full verification protocol was already shown earlier")
    expect(secondOutput.output).toContain("Read every changed file")
  })
})
