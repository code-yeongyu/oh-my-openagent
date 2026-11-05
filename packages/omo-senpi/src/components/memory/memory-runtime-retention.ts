import type { RuntimeRetentionPolicy } from "@oh-my-opencode/memory-core"
import type { OmoMemorySettings } from "@oh-my-opencode/omo-config-core"

/** `memory.runtime` for one identity this session binds: `agents.<id>.runtime` wins field by field. */
export function resolveRuntimeRetentionPolicy(settings: OmoMemorySettings, identity: string): RuntimeRetentionPolicy {
  const base = settings.runtime
  const override = settings.agents[identity]?.runtime
  return {
    retentionDays: override?.retention_days ?? base.retention_days,
    abandonedJournalDays: override?.abandoned_journal_days ?? base.abandoned_journal_days,
    discardUnreflectedJournals: override?.discard_unreflected_journals ?? base.discard_unreflected_journals,
    completionsDays: override?.completions_days ?? base.completions_days,
    passBudgetMs: override?.pass_budget_ms ?? base.pass_budget_ms,
  }
}

export { resolveForeignIdentityDiscardUnreflected } from "@oh-my-opencode/memory-core"

/** `memory.runtime.max_bytes` for one identity (`0` = unbounded): `agents.<id>.runtime` wins. */
export function resolveRuntimeMaxBytes(settings: OmoMemorySettings, identity: string): number {
  return settings.agents[identity]?.runtime?.max_bytes ?? settings.runtime.max_bytes
}
