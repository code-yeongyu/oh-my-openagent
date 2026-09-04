// Memorian gate runner (plan .omo/plans/memorian-m3-gate.md todo 7).
//
// At settle, when lexical candidates exist, ONE quick-category child judges them against the recent
// transcript and answers only through the nudge tool. The launch follows the facts runner's
// semantics - resolveReflectionModel("quick"), warn+skip when the category cannot resolve, no
// fallback ladder, one activeLaunch latch - but carries NO durable machinery: there is no queue, no
// failure store and no run ledger, because a gate run that dies is simply a turn without a nudge.
// The run directory is scratch and is removed once the NDJSON has been read.

import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { mkdir, readFile, rm } from "@oh-my-opencode/memory-core/fs"
import { join } from "node:path"

import {
  PendingNudges,
  parseNudgeLines,
  validateNudges,
  type MemoryIdentityPaths,
  type RecallCandidate,
  type RecallNudge,
} from "@oh-my-opencode/memory-core"
import type { SenpiModelPort, SenpiModelRegistryPort } from "@oh-my-opencode/senpi-task"

import type { ComponentLogger } from "../../extension/types"
import type { SenpiOmoConfigResult } from "../config-resolution"
import { resolveReflectionModel } from "./worker/resolve-model"
import { prepareMemorianSpawn } from "./worker/spawn"
import type { MemorianSandbox, MemorianSpawnArgs, MemorianTranscriptTurn } from "./worker/spawn"

const QUICK_CATEGORY = "quick"
/** The gate advises a turn that already ended; anything slower than this is worthless. */
const DEFAULT_DEADLINE_MS = 5 * 60_000
const TERMINATION_GRACE_MS = 2_000

export interface MemorianGateRunnerOptions {
  readonly identityPaths: MemoryIdentityPaths
  readonly loadConfig: () => SenpiOmoConfigResult
  readonly env: NodeJS.ProcessEnv
  readonly deadlineMs?: number
  /** Seam for the pending store; production builds it from identityPaths.recallPending. */
  readonly pendingNudges?: Pick<PendingNudges, "write" | "delete">
  readonly sandbox?: MemorianSandbox
  /** QA stubbing seam, mirroring the facts runner: the pair replaces the resolved senpi launcher. */
  readonly senpiCommand?: string
  readonly senpiPrefixArgs?: readonly string[]
  readonly logger?: ComponentLogger
}

export interface MemorianGateLaunchInput {
  readonly sessionId: string
  readonly candidates: readonly RecallCandidate[]
  /** Paths already surfaced this session; the parent re-checks them after the child answers. */
  readonly surfaced: ReadonlySet<string>
  readonly maxItems: number
  readonly transcript: readonly MemorianTranscriptTurn[]
  /**
   * The model registry captured SYNCHRONOUSLY at settle, before the host disposed the senpi ctx.
   * The gate launch is fire-and-forget, so by the time it runs any ctx-reading resolver would throw
   * `assertActive`'s stale error. This snapshot is therefore the runner's ONLY registry source:
   * absent means the settle-time capture came back unavailable, and the launch is skipped.
   */
  readonly modelRegistry?: SenpiModelRegistryPort<SenpiModelPort> | undefined
  /**
   * The session's compaction epoch as of THIS launch. The child judges one transcript; a compaction
   * accepted while it runs replaces that transcript, so the verdict must not survive it.
   */
  readonly compactionEpoch?: number
  /** Reads the session's live epoch at write time; a bump means a compaction landed mid-flight. */
  readonly currentCompactionEpoch?: () => number
}

export type MemorianGateLaunchResult =
  /** Another gate run holds the latch; this trigger is dropped. */
  | { readonly status: "active" }
  /** No candidates, or the quick category could not resolve. */
  | { readonly status: "skipped"; readonly cause?: string; readonly model?: string; readonly candidateCount?: number }
  /** The child ran and said nothing the parent accepted. */
  | { readonly status: "empty" }
  /** The child crashed or outran its deadline. */
  | { readonly status: "failed"; readonly cause?: string; readonly model?: string; readonly candidateCount?: number }
  | { readonly status: "dropped"; readonly cause?: string; readonly model?: string; readonly candidateCount?: number }
  | { readonly status: "nudged"; readonly nudges: readonly RecallNudge[]; readonly model?: string }

export class MemorianGateRunner {
  private activeLaunch: Promise<MemorianGateLaunchResult> | undefined

  constructor(private readonly options: MemorianGateRunnerOptions) {}

  /**
   * Fire one gate run. Never throws: the caller is a settle handler, and a failed advisor must
   * leave the turn exactly as it found it.
   */
  async launch(input: MemorianGateLaunchInput): Promise<MemorianGateLaunchResult> {
    if (this.activeLaunch !== undefined) return { status: "active" }
    const operation = this.launchOnce(input).catch((error: unknown) => {
      this.options.logger?.warn("memorian gate launch failed", { error: describe(error) })
      return { status: "failed", cause: "child_failed" } as const
    })
    this.activeLaunch = operation
    try {
      return await operation
    } finally {
      if (this.activeLaunch === operation) this.activeLaunch = undefined
    }
  }

  private async launchOnce(input: MemorianGateLaunchInput): Promise<MemorianGateLaunchResult> {
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

    const runDir = join(this.options.identityPaths.recall, "runs", randomUUID())
    await mkdir(runDir, { recursive: true, mode: 0o700 })
    try {
      const spawnArgs = await prepareMemorianSpawn({
        runDir,
        candidates: input.candidates,
        surfaced: [...input.surfaced],
        maxItems: input.maxItems,
        transcript: input.transcript,
        model: resolution.model,
        ...(resolution.thinking === undefined ? {} : { thinking: resolution.thinking }),
        hardDeadlineAt: Date.now() + (this.options.deadlineMs ?? DEFAULT_DEADLINE_MS),
        env: this.options.env,
        ...(this.options.senpiCommand === undefined ? {} : { senpiCommand: this.options.senpiCommand }),
        ...(this.options.senpiPrefixArgs === undefined ? {} : { senpiPrefixArgs: this.options.senpiPrefixArgs }),
      })
      const prepared = await (this.options.sandbox ?? passthrough)(spawnArgs)
      const completed = await runMemorianChild(prepared)
      if (!completed) return { status: "failed", cause: "child_failed", model: resolution.model, candidateCount: input.candidates.length }
      const nudges = validateNudges(parseNudgeLines(await readNudges(prepared.paths.nudges)), {
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
      if (isStaleAfterCompaction(input)) return this.dropAfterCompaction(input)
      // The launch epoch travels INSIDE the payload, which is what makes the write/compaction race
      // unwinnable-but-harmless: whoever wins, the consumer compares the stamped epoch against the
      // session's live one and refuses a verdict whose transcript a compaction has replaced.
      await pending.write(input.sessionId, nudges, { epoch: input.compactionEpoch ?? 0 })
      // Best-effort hygiene ONLY: a compaction accepted inside write()'s fs window bumps the epoch
      // while its own pending drop still sees no file, so retracting here keeps the directory clean.
      // Correctness no longer depends on this check - the payload's epoch is now authoritative at
      // take() - so losing this race costs nothing.
      if (isStaleAfterCompaction(input)) {
        await pending.delete(input.sessionId)
        return this.dropAfterCompaction(input)
      }
      return { status: "nudged", nudges, model: resolution.model }
    } finally {
      // Scratch only: the NDJSON has been read, so nothing here survives the run.
      await rm(runDir, { recursive: true, force: true }).catch(() => undefined)
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

/**
 * Run the detached child under an absolute deadline. Resolves false for any non-clean end (crash,
 * non-zero exit, deadline, spawn failure); the caller turns that into a silent skip.
 */
async function runMemorianChild(spawnArgs: MemorianSpawnArgs): Promise<boolean> {
  const child = spawn(spawnArgs.command, [...spawnArgs.args], {
    cwd: spawnArgs.cwd,
    env: spawnArgs.env,
    detached: spawnArgs.detached,
    stdio: "ignore",
    windowsHide: true,
  })
  return await new Promise<boolean>((resolve) => {
    let settled = false
    const settle = (value: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      clearTimeout(grace)
      resolve(value)
    }
    let grace: ReturnType<typeof setTimeout> | undefined
    const deadline = setTimeout(() => {
      kill(child, "SIGTERM")
      grace = setTimeout(() => {
        kill(child, "SIGKILL")
        settle(false)
      }, TERMINATION_GRACE_MS)
      grace.unref?.()
    }, Math.max(0, spawnArgs.hardDeadlineAt - Date.now()))
    deadline.unref?.()
    child.once("error", () => settle(false))
    child.once("close", (code) => settle(code === 0))
  })
}

function kill(child: { readonly pid?: number, kill: (signal: NodeJS.Signals) => boolean }, signal: NodeJS.Signals): void {
  try {
    // The child is detached, so it leads its own process group: signal the GROUP or a senpi that
    // spawned helpers would leave them behind.
    if (child.pid !== undefined && process.platform !== "win32") process.kill(-child.pid, signal)
    else child.kill(signal)
  } catch {
    // Already gone.
  }
}

async function readNudges(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8")
  } catch {
    // A silent judge writes no file at all; that is the documented default, not an error.
    return ""
  }
}

function isStaleAfterCompaction(input: MemorianGateLaunchInput): boolean {
  if (input.compactionEpoch === undefined || input.currentCompactionEpoch === undefined) return false
  return input.currentCompactionEpoch() !== input.compactionEpoch
}

function passthrough(spawnArgs: MemorianSpawnArgs): MemorianSpawnArgs {
  return spawnArgs
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
