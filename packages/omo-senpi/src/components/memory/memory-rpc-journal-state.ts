import { readFile } from "@oh-my-opencode/memory-core/fs"
import { join } from "node:path"

import { TranscriptJournal, isCanonicalEntry } from "@oh-my-opencode/memory-core"

import type { MemoryIdentityContext } from "./context"

interface MemoryRpcJournalState {
  readonly transcriptReadFailed?: true
  readonly backlogSteps: number
  readonly pendingCompaction: boolean
  readonly totalSteps: number
  readonly reflectedSteps: number
}

export async function readMemoryRpcJournalState(
  context: MemoryIdentityContext,
  sessionId: string,
  observedSteps?: ReadonlySet<string>,
): Promise<MemoryRpcJournalState> {
  const state = await readDurableJournalState(context, sessionId)
  if (observedSteps === undefined || observedSteps.size === 0) return state
  // The transcript is append-only and state.json is atomically replaced. Observation never
  // takes state.lock or waits for reflection. Union source ids so resume/branch replay cannot
  // double count a step, including when journal reconciliation is still pending.
  const entries = await new TranscriptJournal({
    journalDir: join(context.identityPaths.transcripts, sessionId),
  }).readEntriesSnapshot().catch((error: unknown) => {
    // An unreadable transcript must not drop the required update; state.json remains usable.
    if (error instanceof Error && "code" in error && typeof error.code === "string") return undefined
    throw error
  })
  if (entries === undefined) return { ...state, transcriptReadFailed: true }
  const steps = new Set(observedSteps)
  for (const entry of entries) {
    if (entry.kind === "assistant" && isCanonicalEntry(entry)) steps.add(entry.source_line_id)
  }
  const totalSteps = Math.max(state.totalSteps, steps.size)
  return { ...state, totalSteps, backlogSteps: Math.max(0, totalSteps - state.reflectedSteps) }
}

async function readDurableJournalState(
  context: MemoryIdentityContext,
  sessionId: string,
): Promise<MemoryRpcJournalState> {
  const empty: MemoryRpcJournalState = {
    backlogSteps: 0,
    pendingCompaction: context.ledger.pendingCompaction,
    totalSteps: 0,
    reflectedSteps: 0,
  }
  try {
    const raw: unknown = JSON.parse(
      await readFile(join(context.identityPaths.transcripts, sessionId, "state.json"), "utf8"),
    )
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return empty
    const state = raw as Record<string, unknown>
    return {
      backlogSteps: countOf(state.steps_since_last_successful_reflection),
      pendingCompaction: state.pending_compaction === true || context.ledger.pendingCompaction,
      totalSteps: countOf(state.total_completed_steps),
      reflectedSteps: countOf(state.reflected_completed_steps),
    }
  } catch {
    return empty
  }
}

function countOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}
