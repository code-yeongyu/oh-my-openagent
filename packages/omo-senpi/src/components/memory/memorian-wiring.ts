// Memorian gate wiring (plan .omo/plans/memorian-m3-gate.md todo 8): the settle-side half of the
// gate. It owns no events of its own - the memory component's existing agent_settled handler and
// the reflection trigger's session_compact seam call in - because the gate must observe exactly the
// turns those handlers already agreed were complete.
//
// Nothing here is awaited by the host. A settle returns the instant the work is queued: the gate is
// advisory, and a turn must never pay for the advice about the turn that just ended.

import { PendingNudges, type RecallCandidate } from "@oh-my-opencode/memory-core"
import type { SenpiModelPort, SenpiModelRegistryPort } from "@oh-my-opencode/senpi-task"

import type { ComponentLogger } from "../../extension/types"
import { createOncePerSessionGuard } from "../task/usage-guidance"
import { GATE_ENTRY_TYPE, type MemorianGateRecord } from "./memorian-notice"
import type { MemoryIdentityContext } from "./context"
import type { CollectedRecallCandidates, RecallSessionSnapshot, RecallTranscriptTurn } from "./recall-wiring"

/** The runner seam. Tests and the QA driver substitute a stub; production passes the real runner. */
export interface MemorianGatePort {
  launch(input: {
    readonly sessionId: string
    readonly candidates: readonly RecallCandidate[]
    readonly surfaced: ReadonlySet<string>
    readonly maxItems: number
    readonly transcript: readonly RecallTranscriptTurn[]
    /**
     * Captured at settle, before the host disposed the ctx the registry lives on. Absent means the
     * capture was unavailable, and the runner skips rather than reading a disposed ctx.
     */
    readonly modelRegistry?: SenpiModelRegistryPort<SenpiModelPort> | undefined
    /** The session's compaction epoch at launch time. */
    readonly compactionEpoch?: number
    /** The session's live compaction epoch, read again before the verdict is persisted. */
    readonly currentCompactionEpoch?: () => number
  }): Promise<unknown>
}

export interface MemorianGateWiringOptions {
  /**
   * Synchronous ctx read, called before the launch detaches. Required, and the ONLY seam that ever
   * touches the event ctx: there is deliberately no ctx-reading collection fallback, because the
   * detached task runs after the host disposed the ctx.
   */
  readonly snapshotSession: (eventCtx: unknown) => RecallSessionSnapshot | undefined
  /**
   * Collection over the captured snapshot; consumes no ctx. Undefined already means disabled,
   * sentinel, or no match.
   */
  readonly collectCandidatesFromSnapshot: (
    snapshot: RecallSessionSnapshot,
  ) => Promise<CollectedRecallCandidates | undefined>
  readonly resolveContext: (sessionId: string) => MemoryIdentityContext | undefined
  readonly runnerFor: (context: MemoryIdentityContext) => MemorianGatePort
  /**
   * Reads the model registry off the live senpi ctx. Called SYNCHRONOUSLY inside onSettled, because
   * the host disposes the ctx the moment the handler returns and every later read throws.
   */
  readonly resolveModelRegistry?: (eventCtx: unknown) => SenpiModelRegistryPort<SenpiModelPort> | undefined
  readonly pendingFor?: (context: MemoryIdentityContext) => Pick<PendingNudges, "take">
  readonly logger?: ComponentLogger
}

export interface MemorianGateWiring {
  /** Fire-and-forget gate launch for a settled turn. Returns immediately. */
  onSettled(eventCtx: unknown): void
  /** Binds the live host entry seam after registration; detached launches never retain event ctx. */
  attachEntrySink(appendEntry: (customType: string, data?: unknown) => void): void
  /** Accepted compaction: the pending nudges judged a transcript that no longer exists. */
  onCompactionAccepted(sessionId: string): void
  /**
   * The session's live compaction epoch. The consumption side (recall's before_agent_start drain)
   * reads it to reject a pending payload stamped with a superseded epoch, which is what makes the
   * write-versus-compaction race harmless instead of merely narrow.
   */
  currentCompactionEpoch(sessionId: string): number
  /** Resolves once every launch started so far has finished; tests await this instead of sleeping. */
  whenIdle(): Promise<void>
}

export function createMemorianGateWiring(options: MemorianGateWiringOptions): MemorianGateWiring {
  const pendingFor = options.pendingFor
    ?? ((context: MemoryIdentityContext) => new PendingNudges(context.identityPaths.recallPending))
  const inFlight = new Set<Promise<void>>()
  const skippedOnce = createOncePerSessionGuard()
  let appendEntry: ((customType: string, data?: unknown) => void) | undefined
  // Per-session compaction epoch. A gate child judges ONE transcript; when a compaction is accepted
  // while that child is still running, the pending-file drop in onCompactionAccepted cannot help -
  // the write has not happened yet. The epoch is the in-flight half of the same policy: stamped at
  // launch, bumped on accept, compared before the write. In-memory only, because it guards a
  // process-local in-flight launch and a restart leaves nothing in flight to guard.
  const compactionEpochs = new Map<string, number>()

  function epochOf(sessionId: string): number {
    return compactionEpochs.get(sessionId) ?? 0
  }

  function track(task: () => Promise<void>): void {
    const promise = task()
      .catch((error: unknown) => {
        // The gate is advisory in both directions: a failed launch leaves the next turn exactly as
        // it would have been without memory.
        options.logger?.warn("omo-senpi memorian gate failed", { error: describe(error) })
      })
      .finally(() => {
        inFlight.delete(promise)
      })
    inFlight.add(promise)
  }

  return {
    attachEntrySink(sink): void {
      appendEntry = sink
    },
    onSettled(eventCtx: unknown): void {
      // Snapshot every ctx-derived input BEFORE detaching. The launch below is fire-and-forget by
      // contract, and the host runs AgentSession dispose -> _extensionRunner.invalidate() as soon as
      // this handler returns; any ctx read from the detached task then throws the stale-ctx error and
      // the gate silently never spawns. Everything the async part consumes is a plain value.
      let modelRegistry: SenpiModelRegistryPort<SenpiModelPort> | undefined
      try {
        modelRegistry = options.resolveModelRegistry?.(eventCtx)
      } catch (error) {
        // This capture is the runner's ONLY registry source; an unreadable ctx therefore means the
        // launch will skip. Warn here and let the runner report the skip: no ctx read may be retried
        // from the detached task.
        options.logger?.warn("omo-senpi memorian gate registry snapshot skipped", { error: describe(error) })
      }
      const session = options.snapshotSession(eventCtx)
      if (session === undefined) {
        // No usable session snapshot means there is nothing the detached task could legally read:
        // rereading eventCtx here would hit the disposed ctx. A missed advisory nudge is the
        // designed degradation.
        options.logger?.warn("omo-senpi memorian gate session snapshot incomplete")
        return
      }
      const collectFromSnapshot = options.collectCandidatesFromSnapshot
      const launchedAtEpoch = epochOf(session.id)
      track(async () => {
        // Everything below is a plain captured value; eventCtx is intentionally NOT in this closure.
        const collected = await collectFromSnapshot(session)
        if (collected === undefined) return
        const result = await options.runnerFor(collected.context).launch({
          sessionId: collected.sessionId,
          compactionEpoch: launchedAtEpoch,
          currentCompactionEpoch: () => epochOf(collected.sessionId),
          candidates: collected.candidates,
          surfaced: collected.surfaced,
          maxItems: collected.maxItems,
          transcript: collected.transcript,
          ...(modelRegistry === undefined ? {} : { modelRegistry }),
        })
        if (result !== null && typeof result === "object" && "status" in result) {
          const outcome = result as { status?: string; cause?: string; model?: string; candidateCount?: number }
          if (outcome.status === "skipped" || outcome.status === "failed" || outcome.status === "dropped") {
            const cause = typeof outcome.cause === "string" ? outcome.cause : "unknown"
            if (outcome.status !== "skipped" || skippedOnce(`${collected.sessionId}:${cause}`)) {
              appendEntry?.(GATE_ENTRY_TYPE, {
                version: 1,
                status: outcome.status,
                cause,
                ...(typeof outcome.model === "string" ? { model: outcome.model } : {}),
                candidateCount: outcome.candidateCount ?? collected.candidates.length,
              } satisfies MemorianGateRecord)
            }
          }
        }
      })
    },

    onCompactionAccepted(sessionId: string): void {
      // Bump FIRST and unconditionally: an in-flight child must be invalidated even when the
      // identity context can no longer be resolved for the pending-file drop below.
      compactionEpochs.set(sessionId, epochOf(sessionId) + 1)
      const context = options.resolveContext(sessionId)
      if (context === undefined) return
      track(async () => {
        // take() is read-and-delete, so consuming and discarding IS the drop. A pending payload
        // that outlived its transcript would advise the next turn about a conversation the
        // compaction has already rewritten.
        // The bump above already happened, so this take() passes the NEW epoch: a pre-compaction
        // payload is rejected-and-deleted and a post-bump one is consumed-and-discarded. Both are
        // the drop this handler exists to perform.
        await pendingFor(context).take(sessionId, { currentEpoch: epochOf(sessionId) })
      })
    },

    currentCompactionEpoch(sessionId: string): number {
      return epochOf(sessionId)
    },

    async whenIdle(): Promise<void> {
      while (inFlight.size > 0) await Promise.all([...inFlight])
    },
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
