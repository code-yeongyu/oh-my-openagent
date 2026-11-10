// Retention as a host-sweep step (design 6b): the same pass a bound session runs, applied to an
// identity this process does not host. Foreign identities get the conservative inputs: no live
// sessions are known (none are hosted here), reflection counts as enabled for the health gate, the
// owned-sidecar set is empty, and the unreflected-input switch comes from the GLOBAL config only. The
// size cap runs too, with its journal floor raised to `retention_days` because liveness is unknown.

import { dirname } from "node:path"

import { buildIdentityPaths } from "../identity/layout"
import type { HostSweepIdentity, HostSweepStep } from "../reflection/host-sweep"
import { describeRuntimeCapExcess, measureRuntimeCapEvictableBytes } from "./cap"
import { runRuntimeRetention, summarizeRuntimeRetention } from "./pass"
import { countRuntimePastRetention, countRuntimePastRetentionOtherStores, measureUnreflectedJournalBytes } from "./past-retention"
import { DAY_MS, DEFAULT_RUNTIME_RETENTION, type RuntimeRetentionPolicy } from "./policy"
import { DEFAULT_RUNTIME_MAX_BYTES, measureRuntimeSizeWithinBudget } from "./size"

/** The memory settings shape this decision reads; plain data so the CLI bundle can pass parsed JSON. */
export interface ForeignRuntimeLayer {
  readonly retention_days?: unknown
  readonly abandoned_journal_days?: unknown
  readonly completions_days?: unknown
  readonly pass_budget_ms?: unknown
  readonly max_bytes?: unknown
  readonly discard_unreflected_journals?: unknown
}

export interface ForeignMemoryRuntimeSettings {
  readonly runtime?: ForeignRuntimeLayer
  readonly agents?: Readonly<Record<string, { readonly runtime?: ForeignRuntimeLayer } | undefined>>
}

/**
 * `discard_unreflected_journals` for an identity this process does not host (`omo doctor --fix`, the
 * host sweep's foreign identities; REVIEW-4 M-b). Only the global config is read, never another
 * project's layer, so the switch counts as on only when the global value is on AND the identity's own
 * global override does not turn it off. No readable config means off.
 */
export function resolveForeignIdentityDiscardUnreflected(settings: ForeignMemoryRuntimeSettings | undefined, identity: string): boolean {
  if (settings?.runtime?.discard_unreflected_journals !== true) return false
  return settings.agents?.[identity]?.runtime?.discard_unreflected_journals !== false
}

/** A non-negative finite number from the agent override, else the global value, else the default. */
function window(settings: ForeignMemoryRuntimeSettings | undefined, identity: string, key: keyof Omit<ForeignRuntimeLayer, "discard_unreflected_journals">, fallback: number): number {
  for (const value of [settings?.agents?.[identity]?.runtime?.[key], settings?.runtime?.[key]]) {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value
  }
  return fallback
}

/**
 * The retention policy for an identity the host sweep visits (REVIEW-5 M1): the same windows the
 * session resolves, read from the global layer and its `agents.<id>.runtime` override.
 */
function resolveForeignIdentityRetentionPolicy(settings: ForeignMemoryRuntimeSettings | undefined, identity: string): RuntimeRetentionPolicy {
  return {
    retentionDays: window(settings, identity, "retention_days", DEFAULT_RUNTIME_RETENTION.retentionDays),
    abandonedJournalDays: window(settings, identity, "abandoned_journal_days", DEFAULT_RUNTIME_RETENTION.abandonedJournalDays),
    completionsDays: window(settings, identity, "completions_days", DEFAULT_RUNTIME_RETENTION.completionsDays),
    passBudgetMs: window(settings, identity, "pass_budget_ms", DEFAULT_RUNTIME_RETENTION.passBudgetMs),
    discardUnreflectedJournals: resolveForeignIdentityDiscardUnreflected(settings, identity),
  }
}

/** `max_bytes` for a foreign identity: the agent override, else the global value, else the shipped default. */
function resolveForeignIdentityMaxBytes(settings: ForeignMemoryRuntimeSettings | undefined, identity: string): number {
  return window(settings, identity, "max_bytes", DEFAULT_RUNTIME_MAX_BYTES)
}

export interface RetentionHostSweepStepOptions {
  readonly settings?: ForeignMemoryRuntimeSettings
  /**
   * Identities this process hosts (REVIEW-5 M2). Their own pass already ran with live sessions, owned
   * sidecars and the project layer, so the host sweep must not visit them again with less context.
   */
  readonly isHostedIdentity?: (name: string) => boolean
  readonly now?: () => number
  readonly signal?: AbortSignal
  /** End of the driver's slice: each identity's budget is `min(pass budget, slice remaining)`. */
  readonly deadline?: number
  /** `--fix --dry-run`: retention changes nothing and prints what the pass would remove (#12932). */
  readonly dryRun?: boolean
}

/**
 * The dry-run preview for one identity: read-only counts of what is past its window in every store the
 * pass prunes, by the pass's own rules and in its order (a completion whose run the pass removes is counted),
 * and over the cap what the cap could evict. Locks, reservations, live sessions and live recall ledgers are
 * decided only by the real pass, which can keep some of what the preview counts.
 */
async function previewRetention(identity: string, root: string, policy: RuntimeRetentionPolicy, maxBytes: number, now: () => number, signal: AbortSignal): Promise<string[]> {
  const paths = buildIdentityPaths(dirname(dirname(root)), identity)
  const past = await countRuntimePastRetention({ paths, policy, now, reflectionEnabled: true, signal })
  const other = await countRuntimePastRetentionOtherStores({ paths, policy, now, signal })
  const total = past.runs + past.journals + past.sidecars + other.completions + other.ledgers + other.legacy
  const counts = `runs ${past.runs}, completions ${other.completions}, journals ${past.journals}, sidecars ${past.sidecars}, ledgers ${other.ledgers}, legacy ${other.legacy}`
  const lines = total === 0 ? [] : [`WOULD FIX ${identity} retention would remove ${total} (${counts})`]
  if (maxBytes <= 0) return lines
  const measured = await measureRuntimeSizeWithinBudget(paths.runtime, { budgetMs: policy.passBudgetMs, now: now(), signal })
  if ("sizeUnknown" in measured || measured.size.bytes <= maxBytes) return lines
  const excess = describeRuntimeCapExcess({
    overCapBytes: measured.size.bytes - maxBytes,
    evictableBytes: await measureRuntimeCapEvictableBytes({ paths, policy, now, reflectionEnabled: true, journalFloorMs: policy.retentionDays * DAY_MS, signal }),
    unreflectedBytes: policy.discardUnreflectedJournals ? 0 : await measureUnreflectedJournalBytes({ paths, policy, signal }),
    discardUnreflectedJournals: policy.discardUnreflectedJournals,
  })
  return excess === undefined ? lines : [...lines, `WOULD FIX ${identity} size cap: ${excess}`]
}

export function createRetentionHostSweepStep(options: RetentionHostSweepStepOptions = {}): HostSweepStep {
  const now = options.now ?? Date.now
  return async (identity: HostSweepIdentity) => {
    if (options.isHostedIdentity?.(identity.name) === true) return []
    const policy = resolveForeignIdentityRetentionPolicy(options.settings, identity.name)
    if (options.dryRun === true) {
      const signal = options.signal === undefined ? AbortSignal.timeout(policy.passBudgetMs) : AbortSignal.any([options.signal, AbortSignal.timeout(policy.passBudgetMs)])
      try {
        return await previewRetention(identity.name, identity.root, policy, resolveForeignIdentityMaxBytes(options.settings, identity.name), now, signal)
      } catch (error) {
        if (options.signal?.aborted === true) throw error
        return [`WOULD FIX ${identity.name} retention preview unavailable: ${error instanceof Error ? error.message : String(error)}`]
      }
    }
    const remaining = options.deadline === undefined ? policy.passBudgetMs : Math.max(1, options.deadline - now())
    try {
      const report = await runRuntimeRetention({
        paths: buildIdentityPaths(dirname(dirname(identity.root)), identity.name),
        policy: { ...policy, passBudgetMs: Math.min(policy.passBudgetMs, remaining) },
        maxBytes: resolveForeignIdentityMaxBytes(options.settings, identity.name),
        journalFloorMs: policy.retentionDays * DAY_MS,
        now,
        reflectionEnabled: true,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      })
      const summary = summarizeRuntimeRetention(report)
      if (summary.removed === 0 && report.cursor === undefined) return []
      const counts = `runs ${summary.runs}, completions ${summary.completions}, journals ${summary.journals}, sidecars ${summary.sidecars}, ledgers ${summary.ledgers}, legacy ${summary.reflectionSessions}${report.recallRuns === "removed" ? " + recall/runs" : ""}${report.cap === undefined || report.cap.evicted.length === 0 ? "" : `, size cap ${report.cap.evicted.length}`}`
      return [`FIXED ${identity.name} retention removed ${summary.removed} (${counts})${report.cursor === undefined ? "" : `; resumes at ${report.cursor.store}`}`]
    } catch (error) {
      if (options.signal?.aborted === true) throw error
      return [`FAIL ${identity.name} retention failed: ${error instanceof Error ? error.message : String(error)}`]
    }
  }
}
