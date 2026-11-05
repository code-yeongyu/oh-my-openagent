// Retention as a host-sweep step (design 6b): the same pass a bound session runs, applied to an
// identity this process does not host. Foreign identities get the conservative inputs: no live
// sessions are known (none are hosted here), reflection counts as enabled for the health gate, the
// owned-sidecar set is empty, and the unreflected-input switch comes from the GLOBAL config only.

import { dirname } from "node:path"

import { buildIdentityPaths } from "../identity/layout"
import type { HostSweepIdentity, HostSweepStep } from "../reflection/host-sweep"
import { runRuntimeRetention, summarizeRuntimeRetention } from "./pass"
import { DEFAULT_RUNTIME_RETENTION } from "./policy"

/** The memory settings shape this decision reads; plain data so the CLI bundle can pass parsed JSON. */
export interface ForeignMemoryRuntimeSettings {
  readonly runtime?: { readonly discard_unreflected_journals?: unknown }
  readonly agents?: Readonly<Record<string, { readonly runtime?: { readonly discard_unreflected_journals?: unknown } } | undefined>>
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

export interface RetentionHostSweepStepOptions {
  readonly settings?: ForeignMemoryRuntimeSettings
  readonly now?: () => number
  readonly signal?: AbortSignal
  /** End of the driver's slice: each identity's budget is `min(pass budget, slice remaining)`. */
  readonly deadline?: number
  /** `--fix --dry-run`: retention changes nothing and prints nothing. */
  readonly dryRun?: boolean
}

export function createRetentionHostSweepStep(options: RetentionHostSweepStepOptions = {}): HostSweepStep {
  const now = options.now ?? Date.now
  return async (identity: HostSweepIdentity) => {
    if (options.dryRun === true) return []
    const remaining = options.deadline === undefined ? DEFAULT_RUNTIME_RETENTION.passBudgetMs : Math.max(1, options.deadline - now())
    try {
      const report = await runRuntimeRetention({
        paths: buildIdentityPaths(dirname(dirname(identity.root)), identity.name),
        policy: {
          ...DEFAULT_RUNTIME_RETENTION,
          discardUnreflectedJournals: resolveForeignIdentityDiscardUnreflected(options.settings, identity.name),
          passBudgetMs: Math.min(DEFAULT_RUNTIME_RETENTION.passBudgetMs, remaining),
        },
        now,
        reflectionEnabled: true,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      })
      const summary = summarizeRuntimeRetention(report)
      if (summary.removed === 0 && report.cursor === undefined) return []
      const counts = `runs ${summary.runs}, completions ${summary.completions}, journals ${summary.journals}, sidecars ${summary.sidecars}, ledgers ${summary.ledgers}, legacy ${summary.reflectionSessions}${report.recallRuns === "removed" ? " + recall/runs" : ""}`
      return [`FIXED ${identity.name} retention removed ${summary.removed} (${counts})${report.cursor === undefined ? "" : `; resumes at ${report.cursor.store}`}`]
    } catch (error) {
      if (options.signal?.aborted === true) throw error
      return [`FAIL ${identity.name} retention failed: ${error instanceof Error ? error.message : String(error)}`]
    }
  }
}
