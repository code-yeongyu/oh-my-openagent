import type { ReasoningCoreClient } from "../reasoning-core-policy-gate/reasoning-core-client"
import { log } from "../../shared/logger"
import type { RulePreference } from "./preference-types"

export type PreferenceDerivationKind = "support" | "constraint"

export interface PersistPreferenceToKbArgs {
  client: Pick<ReasoningCoreClient, "kbAdd">
  preference: RulePreference
  kind: PreferenceDerivationKind
  reason: string
}

export async function persistPreferenceToKb(
  args: PersistPreferenceToKbArgs,
): Promise<void> {
  const { client, preference, kind, reason } = args
  if (!client.kbAdd) return

  try {
    await client.kbAdd({
      layer: "Learned",
      content: {
        Preference: {
          superior: preference.superior,
          inferior: preference.inferior,
        },
      },
      tags: [`prefer:${kind}:${reason}`],
    })
  } catch (error) {
    log("[preference-kb-persist] kbAdd failed (non-blocking)", {
      superior: preference.superior,
      inferior: preference.inferior,
      kind,
      reason,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
