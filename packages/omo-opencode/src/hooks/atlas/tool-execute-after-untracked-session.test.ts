import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"

import { createBoulderState, writeBoulderState } from "../../features/boulder-state"
import {
  collectGitDiffStats as productionCollectGitDiffStats,
  formatFileChanges as productionFormatFileChanges,
} from "../../shared/git-worktree"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { handleSubagentCompletionAfter } from "./tool-execute-after-subagent-completion"

describe("handleSubagentCompletionAfter untracked session isolation", () => {
  let directory = ""

  afterEach(() => {
    if (directory) rmSync(directory, { force: true, recursive: true })
  })

  test("#given an active work excludes the caller #when completion arrives #then uses standalone verification", async () => {
    // given
    directory = mkdtempSync(join(tmpdir(), "atlas-untracked-session-"))
    const planPath = join(directory, "plan.md")
    writeFileSync(planPath, "# Plan\n\n- [ ] Tracked task\n", "utf-8")
    writeBoulderState(directory, createBoulderState(planPath, "tracked-session", "atlas"))
    const ctx = unsafeTestValue<PluginInput>({
      directory,
      client: {
        session: {
          get: async () => ({
            data: { parentID: "untracked-session" },
            error: undefined,
            request: new Request("https://example.com/session"),
            response: new Response(null, { status: 200 }),
          }),
        },
      },
    })
    const toolOutput = {
      title: "background_output",
      output: "Completed unrelated work.",
      metadata: { sessionId: "child-session" },
    }

    // when
    await handleSubagentCompletionAfter({
      ctx,
      pendingTaskRefs: new Map(),
      autoCommit: true,
      getState: () => ({ promptFailureCount: 0 }),
      collectGitDiffStats: (() => []) as typeof productionCollectGitDiffStats,
      formatFileChanges: (() => "No file changes") as typeof productionFormatFileChanges,
      toolInput: {
        tool: "background_output",
        sessionID: "untracked-session",
        callID: "call-untracked",
      },
      toolOutput,
      metadataSessionId: "child-session",
    })

    // then
    expect(toolOutput.output).toContain("VERIFICATION_REMINDER")
    expect(toolOutput.output).not.toContain("SUBAGENT WORK COMPLETED")
  })
})
