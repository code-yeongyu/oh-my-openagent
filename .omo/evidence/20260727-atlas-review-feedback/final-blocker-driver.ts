import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"

import {
  clearBoulderPause,
  createBoulderState,
  isBoulderPausedForSession,
  readBoulderState,
  setBoulderPause,
  writeBoulderState,
} from "../../../packages/omo-opencode/src/features/boulder-state"
import { createAtlasEventHandler } from "../../../packages/omo-opencode/src/hooks/atlas/event-handler"
import { handleSubagentCompletionAfter } from "../../../packages/omo-opencode/src/hooks/atlas/tool-execute-after-subagent-completion"
import type { SessionState } from "../../../packages/omo-opencode/src/hooks/atlas/types"
import {
  collectGitDiffStats as productionCollectGitDiffStats,
  formatFileChanges as productionFormatFileChanges,
} from "../../../packages/omo-opencode/src/shared/git-worktree"

function unsafeTestValue<T>(value: unknown): T {
  return value as T
}

const directories: string[] = []

try {
  const multipartDirectory = mkdtempSync(join(tmpdir(), "atlas-final-multipart-"))
  directories.push(multipartDirectory)
  const multipartSession = "multipart-owner"
  writeBoulderState(
    multipartDirectory,
    createBoulderState(join(multipartDirectory, "plan.md"), multipartSession, "atlas"),
  )
  setBoulderPause(multipartDirectory, {
    reason: "final_wave_approval",
    sessionId: multipartSession,
  })
  const multipartHandler = createAtlasEventHandler({
    ctx: unsafeTestValue<PluginInput>({ directory: multipartDirectory }),
    sessions: new Map<string, SessionState>(),
    getState: () => ({ promptFailureCount: 0 }),
  })
  await multipartHandler({ event: {
    type: "message.updated",
    properties: { info: { id: "multipart-message", role: "user", sessionID: multipartSession } },
  } })
  await multipartHandler({ event: {
    type: "message.part.updated",
    properties: {
      part: {
        messageID: "multipart-message",
        sessionID: multipartSession,
        type: "text",
        text: "Called the Read tool with the following input",
        synthetic: true,
      },
    },
  } })
  const syntheticAttachmentTextPreservedCorrelation = isBoulderPausedForSession(multipartDirectory, {
    reason: "final_wave_approval",
    sessionId: multipartSession,
  })
  await multipartHandler({ event: {
    type: "message.part.updated",
    properties: {
      part: { messageID: "multipart-message", sessionID: multipartSession, type: "file" },
    },
  } })
  const attachmentPreservedCorrelation = isBoulderPausedForSession(multipartDirectory, {
    reason: "final_wave_approval",
    sessionId: multipartSession,
  })
  await multipartHandler({ event: {
    type: "message.part.updated",
    properties: {
      part: {
        messageID: "multipart-message",
        sessionID: multipartSession,
        type: "text",
        text: "Approve the final wave.",
      },
    },
  } })
  const laterTextCleared = !isBoulderPausedForSession(multipartDirectory, {
    reason: "final_wave_approval",
    sessionId: multipartSession,
  })

  const authorizationDirectory = mkdtempSync(join(tmpdir(), "atlas-final-authorization-"))
  directories.push(authorizationDirectory)
  const ownerSession = "tracked-owner"
  const unknownSession = "untracked-session"
  const planPath = join(authorizationDirectory, "plan.md")
  writeFileSync(planPath, "# Plan\n\n- [ ] Tracked task\n", "utf-8")
  writeBoulderState(
    authorizationDirectory,
    createBoulderState(planPath, ownerSession, "atlas"),
  )
  setBoulderPause(authorizationDirectory, {
    reason: "final_wave_approval",
    sessionId: ownerSession,
  })
  setBoulderPause(authorizationDirectory, {
    reason: "final_wave_approval",
    sessionId: unknownSession,
  })
  clearBoulderPause(authorizationDirectory, {
    reason: "final_wave_approval",
    sessionId: unknownSession,
  })
  const pauseOwner = readBoulderState(authorizationDirectory)?.pause?.session_id
  const unknownCouldNotMutatePause = pauseOwner === `opencode:${ownerSession}`

  const output = {
    title: "background_output",
    output: "Completed unrelated work.",
    metadata: { sessionId: "child-session" },
  }
  await handleSubagentCompletionAfter({
    ctx: unsafeTestValue<PluginInput>({
      directory: authorizationDirectory,
      client: {
        session: {
          get: async () => ({
            data: { parentID: unknownSession },
            error: undefined,
            request: new Request("https://example.com/session"),
            response: new Response(null, { status: 200 }),
          }),
        },
      },
    }),
    pendingTaskRefs: new Map(),
    autoCommit: true,
    getState: () => ({ promptFailureCount: 0 }),
    collectGitDiffStats: (() => []) as typeof productionCollectGitDiffStats,
    formatFileChanges: (() => "No file changes") as typeof productionFormatFileChanges,
    toolInput: {
      tool: "background_output",
      sessionID: unknownSession,
      callID: "call-untracked",
    },
    toolOutput: output,
    metadataSessionId: "child-session",
  })
  const untrackedUsedStandaloneVerification = output.output.includes("VERIFICATION_REMINDER")
    && !output.output.includes("SUBAGENT WORK COMPLETED")

  const result = {
    syntheticAttachmentTextPreservedCorrelation,
    attachmentPreservedCorrelation,
    laterTextCleared,
    unknownCouldNotMutatePause,
    untrackedUsedStandaloneVerification,
  }
  console.log(JSON.stringify(result, null, 2))
  if (!Object.values(result).every(Boolean)) process.exitCode = 1
} finally {
  for (const directory of directories) {
    rmSync(directory, { force: true, recursive: true })
  }
}
