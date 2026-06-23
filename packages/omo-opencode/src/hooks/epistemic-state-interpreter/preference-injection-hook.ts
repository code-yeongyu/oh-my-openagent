import { getAnnotations } from "./annotation-store"
import { getMultiPlaneAnnotations } from "./annotation-store-v2"
import {
  deriveAspicPreferences,
  injectDerivedPreferences,
} from "./preference-injection-v2"
import {
  persistPreferenceToKb,
  type PreferenceDerivationKind,
} from "./preference-kb-persist"
import {
  getPreferences,
  loadPreferenceStoreFromDisk,
  storePreference,
} from "./preference-store"
import type { RulePreference } from "./preference-types"
import type { ReasoningCoreClient } from "../reasoning-core-policy-gate/reasoning-core-client"
import type { EpistemicAnnotation } from "./types"

const PREFERENCE_DELIMITER = ">"
const COMBINED_EPSILON = 0.001

export interface PreferenceInjectionConfig {
  preference_weights: {
    logico: number
    probabilistico: number
    etico?: number
    pragmatico?: number
    morale?: number
  }
}

export interface PreferenceInjectionHook {
  "tool.execute.before": (
    input: { tool: string; sessionID: string; callID: string },
    output: { args: Record<string, unknown> },
  ) => Promise<void>
}

export interface PreferenceInjectionDeps {
  client?: Pick<ReasoningCoreClient, "kbAdd">
}

function persistDerivedPreference(
  deps: PreferenceInjectionDeps,
  preference: RulePreference,
  kind: PreferenceDerivationKind,
  reason: string,
): void {
  if (!deps.client) return
  void persistPreferenceToKb({ client: deps.client, preference, kind, reason })
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined
  }

  return value as Record<string, unknown>
}

function deriveFromOldAnnotations(
  annotations: EpistemicAnnotation[],
  sessionID: string,
  weights: PreferenceInjectionConfig["preference_weights"],
  deps: PreferenceInjectionDeps,
): void {
  for (let i = 0; i < annotations.length; i++) {
    for (let j = i + 1; j < annotations.length; j++) {
      const left = annotations[i]
      const right = annotations[j]
      const leftScore = computeSimpleScore(left, weights)
      const rightScore = computeSimpleScore(right, weights)
      const delta = leftScore - rightScore

      if (Math.abs(delta) < COMBINED_EPSILON) {
        continue
      }

      const [superior, inferior, strength] =
        delta > 0
          ? [left.conclusion, right.conclusion, leftScore]
          : [right.conclusion, left.conclusion, rightScore]

      const preference: RulePreference = { superior, inferior, strength }
      storePreference(sessionID, preference)
      persistDerivedPreference(deps, preference, "support", "legacy")
    }
  }
}

function computeSimpleScore(
  annotation: EpistemicAnnotation,
  weights: PreferenceInjectionConfig["preference_weights"],
): number {
  const ext = annotation.extensionMembership
  const logico = annotation.proofChainKind === "strict" ? 1 : annotation.proofChainKind === "defeasible" ? 0.5 : 0.7
  const probabilistico = ext.totalCount > 0 ? ext.inCount / ext.totalCount : 0

  return logico * weights.logico + probabilistico * weights.probabilistico
}

function deriveFromMultiPlaneAnnotations(
  sessionID: string,
  deps: PreferenceInjectionDeps,
): void {
  const annotations = getMultiPlaneAnnotations(sessionID)
  if (annotations.length === 0) {
    return
  }

  const annotationMap = new Map(
    annotations
      .filter((a) => a.valutazione !== null)
      .map((a) => [a.conclusion, a.valutazione!.combined]),
  )
  const result = deriveAspicPreferences(annotations)

  for (const entry of result.injected) {
    const superiorCombined = annotationMap.get(entry.superior) ?? 0
    const preference: RulePreference = { superior: entry.superior, inferior: entry.inferior, strength: superiorCombined }
    storePreference(sessionID, preference)
    persistDerivedPreference(deps, preference, "support", "multi-plane")
  }
}

function parseStoredPreferenceKey(key: string): { superior: string; inferior: string } | undefined {
  const separatorIndex = key.indexOf(PREFERENCE_DELIMITER)
  if (separatorIndex <= 0 || separatorIndex >= key.length - 1) {
    return undefined
  }

  return {
    superior: key.slice(0, separatorIndex),
    inferior: key.slice(separatorIndex + 1),
  }
}

function injectStoredPreferences(theory: Record<string, unknown>, sessionID: string): void {
  loadPreferenceStoreFromDisk()
  const stored = getPreferences(sessionID)
  if (stored.size === 0) {
    return
  }

  const existing = Array.isArray(theory.preferences) ? theory.preferences : []
  const injected = [...stored.keys()]
    .map(parseStoredPreferenceKey)
    .filter((value): value is { superior: string; inferior: string } => value !== undefined)

  if (injected.length === 0) {
    return
  }

  theory.preferences = [...existing, ...injected]
}

export function createPreferenceInjectionHook(
  config: PreferenceInjectionConfig,
  deps: PreferenceInjectionDeps = {},
): PreferenceInjectionHook {
  return {
    "tool.execute.before": async (input, output): Promise<void> => {
      if (!input.tool.includes("reason_argue")) {
        return
      }

      loadPreferenceStoreFromDisk()

      const multiPlaneAnnotations = getMultiPlaneAnnotations(input.sessionID)
      if (multiPlaneAnnotations.length > 0) {
        deriveFromMultiPlaneAnnotations(input.sessionID, deps)
      } else {
        const oldAnnotations = getAnnotations(input.sessionID)
        if (oldAnnotations.length > 0) {
          deriveFromOldAnnotations(oldAnnotations, input.sessionID, config.preference_weights, deps)
        }
      }

      const theory = asRecord(output.args.theory)
      if (!theory) {
        return
      }

      injectStoredPreferences(theory, input.sessionID)
    },
  }
}
