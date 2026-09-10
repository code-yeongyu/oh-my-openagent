// Kibitzer gate runner (plan .omo/plans/memorian-m3-gate.md todo 7).
//
// At settle, when lexical candidates exist, ONE quick-category child judges them against the recent
// transcript and answers only through the nudge tool. The launch resolves the quick category the
// way the facts runner does - resolveReflectionModel("quick"), warn+skip when the category cannot
// resolve - and hands the category's own chain to the child as its runtime fallback ladder; only
// the beyond-category ladder is refused. It keeps one activeLaunch latch but carries NO durable
// machinery: there is no queue, no failure store and no run ledger, because a gate run that dies
// is simply a turn without a nudge.
//
// The judge runs IN-PROCESS through senpi-task's InProcessRunner, exactly like the curated
// read-only agents: the child's ResourceLoader has no builtin extensions (no hooks lock can fail
// under it), and it shares the parent snapshot's modelRegistry/authStorage/modelRuntime so engine
// skew is impossible. Its single input is INLINED in the prompt - the candidates payload plus the
// transcript window - so the child needs no file access and no read tool; its single output is the
// nudge closure, which validates against the launch input synchronously and records accepted
// nudges into an array this runner owns. The run directory holds the same payload as
// human-auditable artifacts; outcome.json is persisted and aged run dirs are pruned.

import { randomUUID } from "node:crypto"
import { join } from "node:path"

import {
  validateNudges,
  type MemoryIdentityPaths,
  type RecallCandidate,
  type RecallNudge,
} from "@oh-my-opencode/memory-core"
import type {
  ChildHandle,
  ChildModelRegistry,
  CreateChildSession,
  InProcessRunnerLike,
} from "@oh-my-opencode/senpi-task"

import type { ComponentLogger } from "../../extension/types"
import type { SenpiOmoConfigResult } from "../config-resolution"
import type { RecallTranscriptTurn } from "./recall-wiring"
import { resolveReflectionModel } from "./worker/resolve-model"
import { normalizeGateReason } from "./kibitzer-judge-outcome"
import { runKibitzerJudge } from "./kibitzer-judge-run"
import { abortAndDispose } from "./kibitzer-lifecycle"
import { writeKibitzerRunOutcome } from "./kibitzer-run-retention"

const QUICK_CATEGORY = "quick"
/** The gate advises a turn that already ended; anything slower than this is worthless. */
const DEFAULT_DEADLINE_MS = 5 * 60_000
/** Fixed advisory budget, not config: cap nudge storms at two accepted outcomes per ten minutes. */
const MAX_NUDGES_PER_WINDOW = 2
const NUDGE_WINDOW_MS = 600_000

export interface KibitzerGateRunnerOptions {
  readonly identityPaths: MemoryIdentityPaths
  readonly loadConfig: () => SenpiOmoConfigResult
  readonly env: NodeJS.ProcessEnv
  readonly deadlineMs?: number
  /**
   * QA stubbing seam, mirroring the facts runner's injectable launcher: the pair replaces the
   * child session construction so a fake session can emit tool calls. Production leaves it unset
   * and the InProcessRunner creates a real senpi session.
   */
  readonly createSession?: CreateChildSession
  readonly createRunner?: (options: { readonly createSession?: CreateChildSession }) => InProcessRunnerLike
  readonly logger?: ComponentLogger
}

export interface KibitzerGateLaunchInput {
  readonly sessionId: string
  readonly candidates: readonly RecallCandidate[]
  /** Paths already surfaced this session; the parent re-checks them after the child answers. */
  readonly surfaced: ReadonlySet<string>
  readonly maxItems: number
  readonly transcript: readonly RecallTranscriptTurn[]
  /**
   * The model registry captured SYNCHRONOUSLY at settle, before the host disposed the senpi ctx.
   * The gate launch is fire-and-forget, so by the time it runs any ctx-reading resolver would throw
   * `assertActive`'s stale error. This snapshot is therefore the runner's ONLY registry source:
   * absent means the settle-time capture came back unavailable, and the launch is skipped.
   */
  readonly modelRegistry?: ChildModelRegistry | undefined
  /**
   * The session's compaction epoch as of THIS launch. The child judges one transcript; a compaction
   * accepted while it runs replaces that transcript, so the verdict must not survive it.
   */
  readonly compactionEpoch?: number
  /** Reads the session's live epoch before the verdict is returned; a bump means a compaction landed mid-flight. */
  readonly currentCompactionEpoch?: () => number
  /** Per-launch deadline in ms; wins over the constructed deadline, then the default. */
  readonly deadlineMs?: number
}

/** Precise failure causes: which stage of the in-process launch died. */
export type KibitzerGateFailureCause = "session_create_failed" | "child_failed" | "child_failed_upstream" | "launch_failed"

export type KibitzerGateLaunchResult =
  /** Another gate run holds the latch; this trigger is dropped. */
  | { readonly status: "active"; readonly runId?: string }
  /** No candidates, unavailable judge prerequisites, or the session's nudge budget is exhausted. */
  | { readonly status: "skipped"; readonly cause?: string; readonly model?: string; readonly candidateCount?: number; readonly runId?: string }
  /** The child ran and said nothing the parent accepted. */
  | { readonly status: "empty"; readonly runId?: string; readonly model?: string }
  /** The child session could not be created or its turn failed. */
  | {
    readonly status: "failed"
    readonly cause?: KibitzerGateFailureCause
    readonly model?: string
    readonly candidateCount?: number
    readonly reason?: string
    readonly runId?: string
  }
  /** Dropped causes include cancelled, compaction, and deadline (zero accepted nudges). */
  | { readonly status: "dropped"; readonly cause?: string; readonly model?: string; readonly candidateCount?: number; readonly runId?: string }
  | { readonly status: "nudged"; readonly nudges: readonly RecallNudge[]; readonly model?: string; readonly runId: string; readonly partial?: boolean }

export type KibitzerGateLaunchState = { cancelled: boolean }

export class KibitzerGateRunner {
  private activeLaunch: Promise<KibitzerGateLaunchResult> | undefined
  private activeHandle: ChildHandle | undefined
  private activeState: KibitzerGateLaunchState | undefined
  // Per-session, not per-identity: compaction keeps the budget; a restart may reset this in-memory history.
  private readonly acceptedAtBySession = new Map<string, number[]>()

  constructor(private readonly options: KibitzerGateRunnerOptions) {}

  /**
   * Fire one gate run. Never throws: the caller is a settle handler, and a failed advisor must
   * leave the turn exactly as it found it.
   */
  async launch(input: KibitzerGateLaunchInput): Promise<KibitzerGateLaunchResult> {
    if (this.activeLaunch !== undefined) return { status: "active" }
    const state: KibitzerGateLaunchState = { cancelled: false }
    const operation = this.launchOnce(input, state).catch((error: unknown) => {
      const reason = normalizeGateReason(describe(error))
      this.options.logger?.warn("kibitzer gate launch failed", { error: reason })
      return { status: "failed", cause: "launch_failed", reason } as const
    })
    this.activeLaunch = operation
    this.activeState = state
    try {
      return await operation
    } finally {
      if (this.activeLaunch === operation) {
        this.activeLaunch = undefined
        this.activeState = undefined
      }
    }
  }

  private async launchOnce(input: KibitzerGateLaunchInput, state: KibitzerGateLaunchState): Promise<KibitzerGateLaunchResult> {
    if (input.candidates.length === 0 || input.maxItems <= 0) return { status: "skipped", cause: "no_candidates", candidateCount: input.candidates.length }
    const windowStart = Date.now() - NUDGE_WINDOW_MS
    const acceptedAt = (this.acceptedAtBySession.get(input.sessionId) ?? []).filter((timestamp) => timestamp > windowStart)
    this.acceptedAtBySession.set(input.sessionId, acceptedAt)
    if (acceptedAt.length >= MAX_NUDGES_PER_WINDOW) {
      return { status: "skipped", cause: "cooldown", candidateCount: input.candidates.length }
    }
    // The settle handler's snapshot is authoritative. There is deliberately NO resolver fallback:
    // this task runs after the host disposed the senpi ctx, so any late read throws the stale-ctx
    // error and the only honest answer to a missing snapshot is to skip the advisory run.
    if (input.modelRegistry === undefined) {
      this.options.logger?.warn("kibitzer gate registry snapshot unavailable", { sessionId: input.sessionId })
      return { status: "skipped", cause: "registry_snapshot_unavailable", candidateCount: input.candidates.length }
    }
    const loaded = this.options.loadConfig()
    const resolution = resolveReflectionModel(QUICK_CATEGORY, loaded.config, input.modelRegistry)
    // STRICTER than the facts extractor: `category_unavailable` is not the only unavailable answer.
    // resolveReflectionModel also has a beyond-category ladder (registry_fallback / session_inherit)
    // that resolves ANY usable registry model when the quick chain is dead, and it marks those
    // resolutions with a `source`. Category-sourced resolutions carry no `source`. The gate is
    // pinned to the quick category: an advisory read of a turn that already ended must never land
    // on an arbitrary, possibly frontier-priced model, so anything outside the category counts as
    // unavailable - warn and skip. The category's own chain is the judge's fallback ladder: it is
    // carried into the child (memory-child-model-chain.ts), where the engine rotates rungs mid-turn.
    if (resolution.kind === "category_unavailable" || resolution.source !== undefined) {
      this.options.logger?.warn("kibitzer gate quick category unavailable", {
        cause: resolution.kind === "category_unavailable" ? resolution.cause : resolution.source,
      })
      return { status: "skipped", cause: "quick_category_unavailable", candidateCount: input.candidates.length }
    }

    const runId = randomUUID()
    const accepted: RecallNudge[] = []
    const self = this
    const judged = await runKibitzerJudge({
      options: this.options,
      deadlineMs: input.deadlineMs ?? this.options.deadlineMs ?? DEFAULT_DEADLINE_MS,
      get handle() { return self.activeHandle },
      set handle(value) { self.activeHandle = value },
      get state() { return self.activeState },
      set state(value) { self.activeState = value },
    }, input, resolution, runId, accepted, state)
    if (judged.status === "failed" || judged.status === "dropped") return judged
    const model = judged.model ?? resolution.model
    if (state.cancelled) {
      await overwriteDroppedOutcome(this.options, runId, "cancelled", model)
      return { status: "dropped", cause: "cancelled", model, runId, candidateCount: input.candidates.length }
    }
    // Defence in depth: the closure already validated every recorded nudge at call time, and this
    // re-validation is a no-op for already-validated input (it also drops duplicate paths should
    // the judge repeat one after an accepted call).
    const nudges = validateNudges(accepted, {
      candidates: new Set(input.candidates.map((candidate) => candidate.path)),
      surfaced: input.surfaced,
      maxItems: input.maxItems,
    })
    if (nudges.length === 0) return { status: "empty", runId, model }
    // The judged transcript no longer exists after a compaction; the verdict must not survive it.
    if (state.cancelled || isStaleAfterCompaction(input)) {
      if (state.cancelled) {
        await overwriteDroppedOutcome(this.options, runId, "cancelled", model)
        return { status: "dropped", cause: "cancelled", model, runId, candidateCount: input.candidates.length }
      }
      await overwriteDroppedOutcome(this.options, runId, "compaction", model)
      return this.dropAfterCompaction(input, model, runId)
    }
    // Charge only the final accepted outcome (including salvaged partials), not hints or child starts.
    acceptedAt.push(Date.now())
    return judged.partial === true
      ? { status: "nudged", nudges, model, runId, partial: true }
      : { status: "nudged", nudges, model, runId }
  }

  async cancel(): Promise<void> {
    const state = this.activeState
    if (state !== undefined) state.cancelled = true
    const handle = this.activeHandle
    if (handle === undefined) {
      await this.activeLaunch
      return
    }
    await abortAndDispose(handle, this.options.logger, "shutdown")
  }

  async whenIdle(): Promise<void> {
    await this.activeLaunch
  }

  private dropAfterCompaction(input: KibitzerGateLaunchInput, model: string, runId: string): KibitzerGateLaunchResult {
    this.options.logger?.warn("kibitzer gate nudges dropped after compaction", {
      sessionId: input.sessionId,
      launchedAtEpoch: input.compactionEpoch,
    })
    return { status: "dropped", cause: "compaction", model, runId, candidateCount: input.candidates.length }
  }
}

async function overwriteDroppedOutcome(
  options: KibitzerGateRunnerOptions,
  runId: string,
  cause: "cancelled" | "compaction",
  model: string,
): Promise<void> {
  await writeKibitzerRunOutcome({
    runDir: join(options.identityPaths.recall, "runs", runId),
    runId,
    status: "dropped",
    cause,
    model,
    nudged: [],
    now: () => new Date(),
    warn: (message, fields) => options.logger?.warn(message, fields),
  })
}

function isStaleAfterCompaction(input: KibitzerGateLaunchInput): boolean {
  if (input.compactionEpoch === undefined || input.currentCompactionEpoch === undefined) return false
  return input.currentCompactionEpoch() !== input.compactionEpoch
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
