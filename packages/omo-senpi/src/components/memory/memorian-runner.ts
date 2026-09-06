// Memorian gate runner (plan .omo/plans/memorian-m3-gate.md todo 7).
//
// At settle, when lexical candidates exist, ONE quick-category child judges them against the recent
// transcript and answers only through the nudge tool. The launch follows the facts runner's
// semantics - resolveReflectionModel("quick"), warn+skip when the category cannot resolve, no
// fallback ladder, one activeLaunch latch - but carries NO durable machinery: there is no queue, no
// failure store and no run ledger, because a gate run that dies is simply a turn without a nudge.
//
// The judge runs IN-PROCESS through senpi-task's InProcessRunner, exactly like the curated
// read-only agents: the child's ResourceLoader has no builtin extensions (no hooks lock can fail
// under it), and it shares the parent snapshot's modelRegistry/authStorage/modelRuntime so engine
// skew is impossible. Its single input is INLINED in the prompt - the candidates payload plus the
// transcript window - so the child needs no file access and no read tool; its single output is the
// nudge closure, which validates against the launch input synchronously and records accepted
// nudges into an array this runner owns. The run directory holds the same payload as
// human-auditable artifacts and is KEPT after the run (pruning is a deliberate non-goal).

import { randomUUID } from "node:crypto"
import { mkdir, writeFile } from "@oh-my-opencode/memory-core/fs"
import { join } from "node:path"

import {
  PendingNudges,
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

import { resolveAgentHome } from "../agent-home/resolve-agent-home"
import type { ComponentLogger } from "../../extension/types"
import type { SenpiOmoConfigResult } from "../config-resolution"
import type { RecallTranscriptTurn } from "./recall-wiring"
import { resolveReflectionModel, type ReflectionModelResolution } from "./worker/resolve-model"
import { classifyJudgeTurn, normalizeGateReason } from "./memorian-judge-outcome"
import { buildMemorianJudgeSpec } from "./memorian-judge-spec"
import { memorianCandidatesPayload, renderTranscriptWindow } from "./memorian-prompt"
import { abortAndDispose } from "./memorian-lifecycle"

const QUICK_CATEGORY = "quick"
/** The gate advises a turn that already ended; anything slower than this is worthless. */
const DEFAULT_DEADLINE_MS = 5 * 60_000

export interface MemorianGateRunnerOptions {
  readonly identityPaths: MemoryIdentityPaths
  readonly loadConfig: () => SenpiOmoConfigResult
  readonly env: NodeJS.ProcessEnv
  readonly deadlineMs?: number
  /** Seam for the pending store; production builds it from identityPaths.recallPending. */
  readonly pendingNudges?: Pick<PendingNudges, "write" | "delete">
  /**
   * QA stubbing seam, mirroring the facts runner's injectable launcher: the pair replaces the
   * child session construction so a fake session can emit tool calls. Production leaves it unset
   * and the InProcessRunner creates a real senpi session.
   */
  readonly createSession?: CreateChildSession
  readonly createRunner?: (options: { readonly createSession?: CreateChildSession }) => InProcessRunnerLike
  readonly logger?: ComponentLogger
}

export interface MemorianGateLaunchInput {
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
  /** Reads the session's live epoch at write time; a bump means a compaction landed mid-flight. */
  readonly currentCompactionEpoch?: () => number
}

/** Precise failure causes: which stage of the in-process launch died. */
export type MemorianGateFailureCause = "session_create_failed" | "deadline" | "child_failed" | "launch_failed"

export type MemorianGateLaunchResult =
  /** Another gate run holds the latch; this trigger is dropped. */
  | { readonly status: "active"; readonly runId?: string }
  /** No candidates, or the quick category could not resolve. */
  | { readonly status: "skipped"; readonly cause?: string; readonly model?: string; readonly candidateCount?: number; readonly runId?: string }
  /** The child ran and said nothing the parent accepted. */
  | { readonly status: "empty"; readonly runId?: string }
  /** The child session could not be created, outran its deadline, or its turn failed. */
  | {
    readonly status: "failed"
    readonly cause?: MemorianGateFailureCause
    readonly model?: string
    readonly candidateCount?: number
    readonly reason?: string
    readonly runId?: string
  }
  | { readonly status: "dropped"; readonly cause?: string; readonly model?: string; readonly candidateCount?: number; readonly runId?: string }
  | { readonly status: "nudged"; readonly nudges: readonly RecallNudge[]; readonly model?: string; readonly runId: string }

type LaunchState = { cancelled: boolean }

export class MemorianGateRunner {
  private activeLaunch: Promise<MemorianGateLaunchResult> | undefined
  private activeHandle: ChildHandle | undefined
  private activeState: LaunchState | undefined

  constructor(private readonly options: MemorianGateRunnerOptions) {}

  /**
   * Fire one gate run. Never throws: the caller is a settle handler, and a failed advisor must
   * leave the turn exactly as it found it.
   */
  async launch(input: MemorianGateLaunchInput): Promise<MemorianGateLaunchResult> {
    if (this.activeLaunch !== undefined) return { status: "active" }
    const state: LaunchState = { cancelled: false }
    const operation = this.launchOnce(input, state).catch((error: unknown) => {
      const reason = normalizeGateReason(describe(error))
      this.options.logger?.warn("memorian gate launch failed", { error: reason })
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

  private async launchOnce(input: MemorianGateLaunchInput, state: LaunchState): Promise<MemorianGateLaunchResult> {
    if (input.candidates.length === 0 || input.maxItems <= 0) return { status: "skipped", cause: "no_candidates", candidateCount: input.candidates.length }
    // The settle handler's snapshot is authoritative. There is deliberately NO resolver fallback:
    // this task runs after the host disposed the senpi ctx, so any late read throws the stale-ctx
    // error and the only honest answer to a missing snapshot is to skip the advisory run.
    if (input.modelRegistry === undefined) {
      this.options.logger?.warn("memorian gate registry snapshot unavailable", { sessionId: input.sessionId })
      return { status: "skipped", cause: "registry_snapshot_unavailable", candidateCount: input.candidates.length }
    }
    const loaded = this.options.loadConfig()
    const resolution = resolveReflectionModel(QUICK_CATEGORY, loaded.config, input.modelRegistry)
    // STRICTER than the facts extractor: `category_unavailable` is not the only unavailable answer.
    // resolveReflectionModel also has a beyond-category ladder (registry_fallback / session_inherit)
    // that resolves ANY usable registry model when the quick chain is dead, and it marks those
    // resolutions with a `source`. Category-sourced resolutions carry no `source`. The gate is
    // quick-PINNED with no fallback: an advisory read of a turn that already ended must never land
    // on an arbitrary, possibly frontier-priced model, so anything outside the category counts as
    // unavailable - warn and skip.
    if (resolution.kind === "category_unavailable" || resolution.source !== undefined) {
      this.options.logger?.warn("memorian gate quick category unavailable", {
        cause: resolution.kind === "category_unavailable" ? resolution.cause : resolution.source,
      })
      return { status: "skipped", cause: "quick_category_unavailable", candidateCount: input.candidates.length }
    }

    const runId = randomUUID()
    const accepted: RecallNudge[] = []
    const judged = await this.runJudge(input, resolution, runId, accepted, state)
    if (judged.status === "failed" || judged.status === "dropped") return judged
    if (state.cancelled) return { status: "dropped", cause: "cancelled", runId, candidateCount: input.candidates.length }
    // Defence in depth: the closure already validated every recorded nudge at call time, and this
    // re-validation is a no-op for already-validated input (it also drops duplicate paths should
    // the judge repeat one after an accepted call).
    const nudges = validateNudges(accepted, {
      candidates: new Set(input.candidates.map((candidate) => candidate.path)),
      surfaced: input.surfaced,
      maxItems: input.maxItems,
    })
    if (nudges.length === 0) return { status: "empty" }
    const pending = this.options.pendingNudges ?? new PendingNudges(this.options.identityPaths.recallPending)
    // Cheap early-out: a compaction already accepted needs no file to be written at all. The
    // judged transcript no longer exists, so writing would advise the next turn about a
    // conversation the compaction already rewrote - exactly what onCompactionAccepted's pending
    // drop prevents for verdicts that landed BEFORE the compaction.
    if (state.cancelled || isStaleAfterCompaction(input)) return state.cancelled
      ? { status: "dropped", cause: "cancelled", candidateCount: input.candidates.length }
      : this.dropAfterCompaction(input)
    // The launch epoch travels INSIDE the payload, which is what makes the write/compaction race
    // unwinnable-but-harmless: whoever wins, the consumer compares the stamped epoch against the
    // session's live one and refuses a verdict whose transcript a compaction has replaced.
    await pending.write(input.sessionId, nudges, { epoch: input.compactionEpoch ?? 0 })
    // Best-effort hygiene ONLY: a compaction accepted inside write()'s fs window bumps the epoch
    // while its own pending drop still sees no file, so retracting here keeps the directory clean.
    // Correctness no longer depends on this check - the payload's epoch is now authoritative at
    // take() - so losing this race costs nothing.
    if (state.cancelled || isStaleAfterCompaction(input)) {
      await pending.delete(input.sessionId)
      return state.cancelled
        ? { status: "dropped", cause: "cancelled", candidateCount: input.candidates.length }
        : this.dropAfterCompaction(input)
    }
    return { status: "nudged", nudges, model: resolution.model, runId }
  }

  /**
   * Run the judge as an in-process child session and await its single turn. This owns the whole
   * per-run working set: the run dir, its auditable artifacts, and the child session. The absolute
   * deadline replaces the old SIGTERM/SIGKILL escalation: an abort timer fires handle.abort() and
   * the race resolves the launch immediately, never waiting for a turn that will not settle.
   */
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

  private async runJudge(
    input: MemorianGateLaunchInput,
    resolution: Extract<ReflectionModelResolution, { readonly kind: "resolved" }>,
    runId: string,
    accepted: RecallNudge[],
    state: LaunchState,
  ): Promise<{ readonly status: "completed" } | Extract<MemorianGateLaunchResult, { readonly status: "failed" | "dropped" }>> {
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined
    let deadlineReached = false
    const deadline = new Promise<"deadline">((resolve) => {
      deadlineTimer = setTimeout(() => {
        deadlineReached = true
        resolve("deadline")
      }, Math.max(0, this.options.deadlineMs ?? DEFAULT_DEADLINE_MS))
      deadlineTimer.unref?.()
    })
    const setup = (async (): Promise<ChildHandle> => {
      const runDir = join(this.options.identityPaths.recall, "runs", runId)
      await mkdir(runDir, { recursive: true, mode: 0o700 })
      // Auditable artifacts, NOT inputs: the child receives both inline in its prompt and holds no
      // read tool. The run dir is kept after the run so a live or finished judge can be inspected.
      await Promise.all([
        writeFile(join(runDir, "candidates.json"), `${JSON.stringify(memorianCandidatesPayload(input), null, 2)}\n`, { encoding: "utf8", mode: 0o600 }),
        writeFile(join(runDir, "transcript-window.txt"), renderTranscriptWindow(input.transcript), { encoding: "utf8", mode: 0o600 }),
      ])

      const taskRuntime = await import("#omo-task-runtime")
      const runner = this.options.createRunner?.(
        this.options.createSession === undefined ? {} : { createSession: this.options.createSession },
      ) ?? taskRuntime.createInProcessJudgeRunner(
        this.options.createSession === undefined ? {} : { createSession: this.options.createSession },
      )
      return runner.start(buildMemorianJudgeSpec({ launch: input, runId, runDir, agentDir: resolveAgentHome({ env: this.options.env }), model: input.modelRegistry === undefined ? undefined : taskRuntime.findModelReference(input.modelRegistry, resolution.model), ...(resolution.thinking === undefined ? {} : { thinkingLevel: resolution.thinking }), accepted }))
    })()
    const setupResult = setup.then(
      async (handle) => {
        if (deadlineReached || state.cancelled) {
          await abortAndDispose(handle, this.options.logger, runId)
          return undefined
        }
        this.activeHandle = handle
        this.activeState = state
        return handle
      },
      (error: unknown) => {
        if (deadlineReached || state.cancelled) return undefined
        throw error
      },
    )
    try {
      const settled = await Promise.race([setupResult, deadline])
      if (settled === "deadline" || settled === undefined) {
        const handle = this.activeHandle
        if (handle !== undefined) await abortAndDispose(handle, this.options.logger, runId)
        if (state.cancelled && settled === undefined) {
          return { status: "dropped", cause: "cancelled", runId, candidateCount: input.candidates.length }
        }
        this.options.logger?.warn("memorian gate deadline exceeded", { runId })
        state.cancelled = true
        return { status: "failed", cause: "deadline", model: resolution.model, candidateCount: input.candidates.length, runId }
      }
      const turn = await Promise.race([settled.waitForIdle(), deadline])
      if (turn === "deadline") {
        this.options.logger?.warn("memorian gate deadline exceeded", { runId })
        await abortAndDispose(settled, this.options.logger, runId)
        return { status: "failed", cause: "deadline", model: resolution.model, candidateCount: input.candidates.length, runId }
      }
      const classification = classifyJudgeTurn(turn)
      if (classification.status === "failed") {
        const reason = normalizeGateReason(classification.reason)
        this.options.logger?.warn("memorian gate child failed", { runId, cause: "child_failed", reason })
        return { status: "failed", cause: "child_failed", reason, runId, model: resolution.model, candidateCount: input.candidates.length }
      }
      if (classification.status === "dropped") return { status: "dropped", cause: "cancelled", runId, candidateCount: input.candidates.length }
      return { status: "completed" }
    } catch (error) {
      this.options.logger?.warn("memorian gate child session creation failed", { error: normalizeGateReason(describe(error)), runId })
      return { status: "failed", cause: "session_create_failed", reason: normalizeGateReason(describe(error)), runId, model: resolution.model, candidateCount: input.candidates.length }
    } finally {
      const handle = (clearTimeout(deadlineTimer), this.activeHandle)
      if (handle !== undefined) {
        this.activeHandle = undefined
        handle.dispose()
      }
    }
  }

  private dropAfterCompaction(input: MemorianGateLaunchInput): MemorianGateLaunchResult {
    this.options.logger?.warn("memorian gate nudges dropped after compaction", {
      sessionId: input.sessionId,
      launchedAtEpoch: input.compactionEpoch,
    })
    return { status: "dropped", cause: "compaction", candidateCount: input.candidates.length }
  }
}

function isStaleAfterCompaction(input: MemorianGateLaunchInput): boolean {
  if (input.compactionEpoch === undefined || input.currentCompactionEpoch === undefined) return false
  return input.currentCompactionEpoch() !== input.compactionEpoch
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
