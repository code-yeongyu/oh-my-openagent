import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { buildIdentityPaths } from "@oh-my-opencode/memory-core"
import { createMemoryIdentityContext } from "../context"
import type { ReflectionCompletionRecord } from "./completion-contracts"

export async function recapFixture(root: string, overrides: Partial<ReflectionCompletionRecord> = {}) {
  const context = createMemoryIdentityContext({
    identity: "agent-test",
    identityPaths: buildIdentityPaths(root, "agent-test"),
    binding: { identity: "agent-test", repoPathHash: "hash", boundAt: 1 },
  })
  const record: ReflectionCompletionRecord = {
    schemaVersion: 1, runId: "reflection-run-7", identity: context.identity,
    category: "quick", conversationIds: ["conversation-a", "conversation-b"],
    trigger: "manual", outcome: "merged",
    startedAt: "2026-09-09T12:00:00.000Z", finishedAt: "2026-09-09T12:00:01.000Z",
    mergedCommitSha: "a".repeat(40), filesChanged: 1, delivery: { status: "pending" },
    ...overrides,
  }
  const runDir = join(context.identityPaths.reflection, "runs", record.runId)
  const completionsDir = join(context.identityPaths.reflection, "completions")
  await mkdir(runDir, { recursive: true })
  await mkdir(completionsDir, { recursive: true })
  const ledger = {
    version: 1, runId: record.runId, attempt: 1, kind: "reflection", trigger: "manual",
    startedAt: record.startedAt, finalizedAt: record.finishedAt,
    hardDeadlineAt: 1000, terminationGraceMs: 100, deadlineAt: 1100,
    mergePolicy: "auto", worktreeDir: "synthetic", worktreeBranch: "synthetic",
    baseSha: "b".repeat(40), gitFilePath: "synthetic", gitFileSnapshot: "synthetic",
    commonConfigPath: "synthetic", commonConfigSnapshot: null,
    finalizePhase: "integrated", finalizeOutcome: "merged", integrationSha: record.mergedCommitSha,
    validatedChangedPaths: ["reference/synthetic.md"], conversationIds: record.conversationIds,
  }
  const outcome = {
    version: 1, runId: record.runId, attempt: 1, finishedAt: record.finishedAt,
    childExit: { code: 0, signal: null }, timedOut: false,
  }
  const report = "# RECAP_SENTINEL\n\n한국어 기록\n- Saved synthetic preference\n"
  await Promise.all([
    writeFile(join(runDir, "ledger.json"), JSON.stringify(ledger)),
    writeFile(join(runDir, "outcome.json"), JSON.stringify(outcome)),
    writeFile(join(runDir, "child-stdout.log"), report),
    writeFile(join(completionsDir, `${record.runId}.json`), JSON.stringify(record)),
  ])
  return { context, record, runDir, completionsDir, ledger, outcome, report }
}
