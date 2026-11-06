// The runtime retention pass and the host-sweep slice that memory-maintenance.ts runs when one is due. They
// ship in the memory commands sidecar (commands/runtime.ts) and load through loadMemoryCommandsRuntime, so
// the entry bundle carries only the scheduler and its due checks. Nothing in the entry bundle may import
// this module statically.

import {
  DEFAULT_RUNTIME_MAX_BYTES,
  DEFAULT_RUNTIME_RETENTION,
  RETENTION_STAMP_CONFIG_KEY,
  createRetentionHostSweepStep,
  retentionResumePending,
  runRuntimeRetention,
  summarizeRuntimeRetention,
  sweepHostIdentities,
  type ForeignMemoryRuntimeSettings,
  type GitMemoryRepo,
  type MemoryIdentityPaths,
  type RuntimeRetentionPolicy,
} from "@oh-my-opencode/memory-core"
import type { OmoMemorySettings } from "@oh-my-opencode/omo-config-core"

import { resolveRuntimeMaxBytes, resolveRuntimeRetentionPolicy } from "./memory-runtime-retention"

export { retentionResumePending }

type Log = (message: string, data?: Record<string, unknown>) => void

export interface MaintenanceRetentionInput {
  readonly identity: string
  readonly paths: MemoryIdentityPaths
  readonly repo: GitMemoryRepo
  readonly signal: AbortSignal
  readonly now: () => number
  readonly policy?: RuntimeRetentionPolicy
  readonly maxBytes?: number
  readonly settings?: OmoMemorySettings
  readonly reflectionEnabled: boolean
  readonly isLiveSession?: (sessionId: string) => boolean
  readonly ownedSidecars?: ReadonlySet<string>
  readonly info?: Log
  readonly warn?: Log
}

/** One identity's retention pass; the completion stamp is written after the work, so an interrupted pass resumes at the next bind. */
export async function runMaintenanceRetention(input: MaintenanceRetentionInput): Promise<void> {
  const report = await runRuntimeRetention({
    paths: input.paths,
    policy: input.policy ?? (input.settings === undefined ? DEFAULT_RUNTIME_RETENTION : resolveRuntimeRetentionPolicy(input.settings, input.identity)),
    maxBytes: input.maxBytes ?? (input.settings === undefined ? DEFAULT_RUNTIME_MAX_BYTES : resolveRuntimeMaxBytes(input.settings, input.identity)),
    now: input.now,
    signal: input.signal,
    reflectionEnabled: input.reflectionEnabled,
    ...(input.isLiveSession === undefined ? {} : { isLiveSession: input.isLiveSession }),
    ...(input.ownedSidecars === undefined ? {} : { ownedSidecars: input.ownedSidecars }),
    warn: (message, fields) => input.warn?.(message, { identity: input.identity, ...fields }),
  })
  const summary = summarizeRuntimeRetention(report)
  if (summary.removed > 0 || report.skipped.length > 0 || report.cursor !== undefined) {
    input.info?.("omo-senpi memory runtime retention", { identity: input.identity, ...summary })
  }
  // A pass whose stores finished and whose cap could not even measure is stamped too: its cap resume point
  // is kept for the next due pass, which comes at the interval (#12538 review r5 L1).
  const capStalled = report.cap?.skipped.includes("measure-over-budget") === true
  if (report.cursor === undefined || capStalled) await input.repo.configSet(RETENTION_STAMP_CONFIG_KEY, String(input.now()))
  if (report.cap !== undefined && report.cap.exceededBytes > 0) {
    // "Nothing evictable" only when the cap walked every tier: a budget stop (cursor), a measurement
    // past the budget and skipped journal tiers all leave evictable data for the next pass.
    const unfinished = [...(report.cap.cursor === undefined ? [] : ["budget"]), ...report.cap.skipped]
    input.warn?.(
      unfinished.length === 0 ? "omo-senpi memory runtime cap exceeded, nothing evictable" : "omo-senpi memory runtime cap exceeded, eviction continues next pass",
      {
        identity: input.identity,
        overCapBytes: report.cap.exceededBytes,
        ...(unfinished.length === 0 ? {} : { reason: unfinished }),
        kept: report.cap.kept,
      },
    )
  }
}

const HOST_SWEEP_IDENTITIES_PER_PASS = 25
const HOST_SWEEP_SLICE_MS = 30_000

export interface MaintenanceHostSweepInput {
  readonly memoryRoot: string
  readonly settings?: ForeignMemoryRuntimeSettings
  readonly isHostedIdentity: (name: string) => boolean
  readonly signal: AbortSignal
  readonly now: () => number
  readonly info?: Log
}

export async function runMaintenanceHostSweep(input: MaintenanceHostSweepInput): Promise<void> {
  const deadline = input.now() + HOST_SWEEP_SLICE_MS
  const result = await sweepHostIdentities({
    memoryRoot: input.memoryRoot,
    steps: [createRetentionHostSweepStep({
      ...(input.settings === undefined ? {} : { settings: input.settings }),
      isHostedIdentity: input.isHostedIdentity,
      now: input.now,
      signal: input.signal,
      deadline,
    })],
    maxIdentities: HOST_SWEEP_IDENTITIES_PER_PASS,
    budgetMs: HOST_SWEEP_SLICE_MS,
    now: input.now,
    signal: input.signal,
  })
  if (result.status === "swept" && result.lines.length > 0) {
    input.info?.("omo-senpi memory host sweep", { visited: result.visited.length, completed: result.completed, lines: result.lines })
  }
}
