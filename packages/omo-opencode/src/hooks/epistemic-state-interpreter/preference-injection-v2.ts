import type { DerivedPreference } from "./preference-derivation-v2"
import type { MultiPlaneAnnotation } from "./multi-plane-types"

const COMBINED_EPSILON = 0.001

export interface AspicPreferenceEntry {
  superior: string
  inferior: string
}

export interface PreferenceInjectionResult {
  injected: AspicPreferenceEntry[]
  blocked: string[]
}

type ComparableAnnotation = Pick<DerivedPreference, "combined" | "conclusion" | "divergente">

function toComparableAnnotation(
  annotation: MultiPlaneAnnotation,
): ComparableAnnotation | null {
  if (annotation.valutazione === null) {
    return null
  }

  return {
    conclusion: annotation.conclusion,
    combined: annotation.valutazione.combined,
    divergente: annotation.valutazione.divergente,
  }
}

export function deriveAspicPreferences(
  annotations: MultiPlaneAnnotation[],
): PreferenceInjectionResult {
  const comparable = annotations
    .map(toComparableAnnotation)
    .filter((annotation): annotation is ComparableAnnotation => annotation !== null)
  const injected: AspicPreferenceEntry[] = []
  const superiors = new Set<string>()

  for (let i = 0; i < comparable.length; i++) {
    for (let j = i + 1; j < comparable.length; j++) {
      const left = comparable[i]
      const right = comparable[j]
      const delta = left.combined - right.combined

      if (Math.abs(delta) < COMBINED_EPSILON) {
        continue
      }

      const superior = delta > 0 ? left : right
      const inferior = delta > 0 ? right : left

      superiors.add(superior.conclusion)
      injected.push({
        superior: superior.conclusion,
        inferior: inferior.conclusion,
      })
    }
  }

  return {
    injected,
    blocked: comparable
      .filter((annotation) => !superiors.has(annotation.conclusion))
      .map((annotation) => annotation.conclusion),
  }
}

export function injectDerivedPreferences(
  theory: Record<string, unknown>,
  result: PreferenceInjectionResult,
): void {
  if (result.injected.length === 0) {
    return
  }

  const existing = Array.isArray(theory.preferences) ? theory.preferences : []
  theory.preferences = [...existing, ...result.injected]
}
