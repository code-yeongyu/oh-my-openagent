/// <reference types="bun-types" />

import { afterEach, describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"
import {
  collectGitDiffStats as productionCollectGitDiffStats,
  formatFileChanges as productionFormatFileChanges,
} from "../../shared/git-worktree"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { handleSubagentCompletionAfter } from "./tool-execute-after-subagent-completion"

type SessionGetInput = { readonly path: { readonly id: string } }
type SessionGetResult = {
  readonly data: { readonly parentID: string | undefined }
  readonly error?: undefined
  readonly request: Request
  readonly response: Response
}

describe("handleSubagentCompletionAfter background_output incomplete reports", () => {
  const temporaryDirectories: string[] = []

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  function createSessionGetResult(parentID: string | undefined): SessionGetResult {
    return {
      data: { parentID },
      error: undefined,
      request: new Request("https://example.com/session"),
      response: new Response(null, { status: 200 }),
    }
  }

  function createContext(): PluginInput {
    const directory = mkdtempSync(join(tmpdir(), "atlas-background-output-incomplete-"))
    temporaryDirectories.push(directory)

    return unsafeTestValue<PluginInput>({
      client: {
        session: {
          get: async (input: SessionGetInput) =>
            createSessionGetResult(input.path.id === "ses_child" ? "ses_parent" : undefined),
        },
      },
      directory,
      worktree: directory,
      serverUrl: new URL("https://example.com"),
      $: Bun.$,
    })
  }

  async function runBackgroundOutput(output: string): Promise<{
    readonly output: string
    readonly collectCalls: number
  }> {
    let collectCalls = 0
    const collectGitDiffStats: typeof productionCollectGitDiffStats = () => {
      collectCalls += 1
      return []
    }
    const formatFileChanges: typeof productionFormatFileChanges = () => "No file changes"
    const toolOutput = {
      title: "background_output",
      output,
      metadata: { sessionId: "ses_child" },
    }

    await handleSubagentCompletionAfter({
      ctx: createContext(),
      pendingTaskRefs: new Map(),
      autoCommit: true,
      getState: () => ({ promptFailureCount: 0 }),
      collectGitDiffStats,
      formatFileChanges,
      toolInput: {
        tool: "background_output",
        sessionID: "ses_parent",
        callID: "call-background-output",
      },
      toolOutput,
      metadataSessionId: "ses_child",
    })

    return { output: toolOutput.output, collectCalls }
  }

  for (const status of ["pending", "running", "error", "cancelled", "interrupt"] as const) {
    it(`#given a ${status} task status table #when handled #then it is left untouched`, async () => {
      const output = `# Task Status

| Field | Value |
|-------|-------|
| Task ID | \`bg_${status}\` |
| Description | Implement auth flow |
| Agent | Sisyphus Junior |
| Status | **${status}** |
| Session ID | \`ses_child\` |
`

      const result = await runBackgroundOutput(output)

      expect(result.output).toBe(output)
      expect(result.output).not.toContain("COMPLETION GATE")
      expect(result.output).not.toContain("SUBAGENT WORK COMPLETED")
      expect(result.collectCalls).toBe(0)
    })
  }

  it("#given background_output cannot fetch messages #when handled #then it is left untouched", async () => {
    const output = "Error fetching messages: task still running"

    const result = await runBackgroundOutput(output)

    expect(result.output).toBe(output)
    expect(result.output).not.toContain("COMPLETION GATE")
    expect(result.output).not.toContain("SUBAGENT WORK COMPLETED")
    expect(result.collectCalls).toBe(0)
  })

  it("#given completed output contains a status-like table #when handled #then verification reminder is still appended", async () => {
    const output = `Completed implementation.

The generated report includes this markdown from the child process:

| Field | Value |
|-------|-------|
| Status | **running** |
`

    const result = await runBackgroundOutput(output)

    expect(result.output).toContain("VERIFICATION_REMINDER")
    expect(result.collectCalls).toBe(1)
  })
})
