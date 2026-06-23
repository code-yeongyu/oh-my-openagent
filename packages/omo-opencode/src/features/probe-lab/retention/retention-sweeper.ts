import type { ProbeStore } from "../sqlite-store"
import { DEFAULT_RETENTION_POLICY, type RetentionPolicy } from "./retention-policy"

export type RetentionSweepResult = {
  exchanges_blanked: number
  audit_rows_deleted: number
  rate_limits_deleted: number
  captures_deleted: number
}

export type RetentionSweepDeps = {
  store: ProbeStore
  policy?: Partial<RetentionPolicy>
  dryRun?: boolean
  now?: () => number
}

export function runRetentionSweep(deps: RetentionSweepDeps): RetentionSweepResult {
  const policy = { ...DEFAULT_RETENTION_POLICY, ...deps.policy }
  const now = (deps.now ?? (() => Math.floor(Date.now() / 1000)))()
  const dry = deps.dryRun ?? false
  const exchangeCutoff = now - policy.exchanges_response_body_days * 86_400
  const auditCutoff = now - policy.audit_log_days * 86_400
  const captureCutoff = now - policy.captures_days * 86_400
  return {
    exchanges_blanked: dry
      ? deps.store.countExchangeBodiesOlderThan(exchangeCutoff)
      : deps.store.blankExchangeBodiesOlderThan(exchangeCutoff),
    audit_rows_deleted: dry
      ? deps.store.countAuditLogOlderThan(auditCutoff)
      : deps.store.deleteAuditLogOlderThan(auditCutoff),
    rate_limits_deleted: dry
      ? deps.store.countRateLimitsOlderThan(policy.rate_limit_observations_days)
      : deps.store.deleteRateLimitsOlderThan(policy.rate_limit_observations_days),
    captures_deleted: dry
      ? deps.store.countCapturesOlderThan(captureCutoff)
      : deps.store.deleteCapturesOlderThan(captureCutoff),
  }
}
