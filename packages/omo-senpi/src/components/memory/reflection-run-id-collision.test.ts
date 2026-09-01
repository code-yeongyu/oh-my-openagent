import { afterEach, describe, expect, test } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  ReflectionReservationStore,
  TranscriptJournal,
  buildIdentityPaths,
  type MemoryIdentity,
  type MemoryIdentityPaths,
  type ReflectionRequest,
} from "@oh-my-opencode/memory-core"

import { createReflectionRunIdFactory } from "./reflection-run-id"
import { ensureReflectionCompletion } from "./worker/completion-records"
import type { ReflectionCompletionRecord } from "./worker/completion-contracts"

const roots: string[] = []
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }))),
)

interface Fixture {
  readonly identity: MemoryIdentity
  readonly paths: MemoryIdentityPaths
  readonly journal: TranscriptJournal
}

async function fixture(): Promise<Fixture> {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "reflection-runid-collision-")))
  roots.push(root)
  const identity: MemoryIdentity = {
    id: "agent-test",
    safeSlug: "agent-test",
    paths: buildIdentityPaths(root, "agent-test"),
  }
  const journal = new TranscriptJournal({ journalDir: join(identity.paths.transcripts, "conversation-a") })
  await journal.reconcile([{ kind: "assistant", messageId: "assistant-1", textBlocks: ["one"] }])
  return { identity, paths: identity.paths, journal }
}

/** A store wired exactly the way identity-runtime wires it: run ids scoped to persisted state. */
function launchStore(state: Fixture): ReflectionReservationStore {
  return new ReflectionReservationStore({
    identity: state.identity,
    config: { stepCount: 1, onCompaction: true },
    getJournal: async (conversationId) => {
      if (conversationId !== "conversation-a") throw new Error(`unknown conversation: ${conversationId}`)
      return state.journal
    },
    createRunId: createReflectionRunIdFactory({ identityPaths: state.paths }),
  })
}

async function manualRequest(state: Fixture): Promise<ReflectionRequest> {
  const snapshot = await state.journal.captureReflectionSnapshot()
  if (snapshot === null) throw new Error("expected a reflection snapshot")
  return {
    trigger: "manual",
    conversationIds: ["conversation-a"],
    snapshots: [{ conversationId: "conversation-a", snapshot }],
  }
}

function completionFor(runId: string, overrides: Partial<ReflectionCompletionRecord>): ReflectionCompletionRecord {
  return {
    schemaVersion: 1,
    runId,
    identity: "agent-test",
    category: "quick",
    conversationIds: ["conversation-a"],
    trigger: "manual",
    outcome: "merged",
    startedAt: "2026-08-25T09:00:00.000Z",
    finishedAt: "2026-08-25T09:01:00.000Z",
    durationMs: 60_000,
    consecutiveFailures: 0,
    delivery: { status: "pending" },
    ...overrides,
  }
}

/**
 * Generation one's debris as issue #7095 found it: consumed bwrap-failure completion records plus
 * their run directories, left behind when `runtime/reflection-sessions/` was recreated empty.
 */
async function seedStaleGeneration(paths: MemoryIdentityPaths): Promise<void> {
  const completionsDir = join(paths.reflection, "completions")
  await mkdir(completionsDir, { recursive: true, mode: 0o700 })
  await mkdir(join(paths.reflection, "runs", "reflection-run-1"), { recursive: true, mode: 0o700 })
  await writeFile(
    join(completionsDir, "reflection-run-1.json"),
    `${JSON.stringify(
      completionFor("reflection-run-1", {
        trigger: "step-count",
        outcome: "failed",
        reason: "child_exit",
        detail: "bwrap: setting up uid map: Permission denied",
        startedAt: "2026-08-22T10:07:00.000Z",
        finishedAt: "2026-08-22T10:07:00.200Z",
        durationMs: 200,
        consecutiveFailures: 7,
        delivery: { status: "consumed" },
      }),
      null,
      2,
    )}\n`,
    "utf8",
  )
}

describe("reflection run ids across a run-counter reset", () => {
  test("#given stale generation-one completion records #when a fresh process reserves and publishes #then the retired id is never re-minted", async () => {
    // given
    const state = await fixture()
    await seedStaleGeneration(state.paths)
    const completionsDir = join(state.paths.reflection, "completions")

    // when
    const reserved = await launchStore(state).tryReserve(await manualRequest(state))
    if (reserved.status !== "active") throw new Error("expected an active reservation")
    const published = await ensureReflectionCompletion(
      completionsDir,
      completionFor(reserved.run.runId, { outcome: "no_changes" }),
    )

    // then
    expect(reserved.run.runId).toBe("reflection-run-2")
    expect(published.runId).toBe("reflection-run-2")
  })

  test("#given a run published by a fresh generation #when the stale record is re-read #then it is byte-identical", async () => {
    // given
    const state = await fixture()
    await seedStaleGeneration(state.paths)
    const completionsDir = join(state.paths.reflection, "completions")
    const staleBefore = await readFile(join(completionsDir, "reflection-run-1.json"), "utf8")
    const reserved = await launchStore(state).tryReserve(await manualRequest(state))
    if (reserved.status !== "active") throw new Error("expected an active reservation")
    expect(reserved.run.runId).not.toBe("reflection-run-1")

    // when
    await ensureReflectionCompletion(completionsDir, completionFor(reserved.run.runId, {}))

    // then
    expect(await readFile(join(completionsDir, "reflection-run-1.json"), "utf8")).toBe(staleBefore)
    expect(JSON.parse(await readFile(join(completionsDir, `${reserved.run.runId}.json`), "utf8"))).toMatchObject({
      runId: reserved.run.runId,
      outcome: "merged",
    })
  })

  test("#given two successive launches sharing one identity #when each publishes a completion #then neither collides with the other", async () => {
    // given
    const state = await fixture()
    await seedStaleGeneration(state.paths)
    const completionsDir = join(state.paths.reflection, "completions")

    // when
    const first = await launchStore(state).tryReserve(await manualRequest(state))
    if (first.status !== "active") throw new Error("expected an active reservation")
    await ensureReflectionCompletion(completionsDir, completionFor(first.run.runId, { outcome: "no_changes" }))
    await launchStore(state).complete(first.run.runId, "no_changes")
    await state.journal.reconcile([{ kind: "assistant", messageId: "assistant-2", textBlocks: ["two"] }])
    const second = await launchStore(state).tryReserve(await manualRequest(state))
    if (second.status !== "active") throw new Error("expected an active reservation")

    // then
    expect(first.run.runId).toBe("reflection-run-2")
    expect(second.run.runId).toBe("reflection-run-3")
    await expect(
      ensureReflectionCompletion(completionsDir, completionFor(second.run.runId, { outcome: "merged" })),
    ).resolves.toMatchObject({ runId: second.run.runId })
  })
})
