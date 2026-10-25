import {
  agreementItemsOf,
  DEFAULT_AGREEMENTS_POLICY,
  knownAgreementsOf,
  readAgreementsWorktree,
  type AgreementsPolicy,
  type FactsKnownAgreement,
} from "@oh-my-opencode/memory-core"
import type { OmoConfig } from "@oh-my-opencode/omo-config-core"

export const FACTS_AGREEMENTS_FILENAME = "agreements.jsonl"

export interface FactsAgreementsSettings {
  readonly enabled: boolean
  readonly policy: AgreementsPolicy
}

export function resolveFactsAgreements(config: OmoConfig, identity: string): FactsAgreementsSettings {
  const memory = config.memory
  const override = memory?.agents[identity]?.agreements
  const base = memory?.agreements
  return {
    enabled: override?.enabled ?? base?.enabled ?? true,
    policy: {
      needsHumanThreshold: override?.needs_human_threshold ?? base?.needs_human_threshold
        ?? DEFAULT_AGREEMENTS_POLICY.needsHumanThreshold,
      maxItems: override?.max_items ?? base?.max_items ?? DEFAULT_AGREEMENTS_POLICY.maxItems,
    },
  }
}

export async function readFactsAgreementsPayload(
  repoDir: string,
  settings: FactsAgreementsSettings,
): Promise<{ readonly agreements?: readonly FactsKnownAgreement[] }> {
  if (!settings.enabled) return {}
  return { agreements: knownAgreementsOf(agreementItemsOf(await readAgreementsWorktree(repoDir))) }
}
