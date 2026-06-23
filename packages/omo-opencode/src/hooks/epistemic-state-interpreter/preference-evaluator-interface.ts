import type { EpistemicAnnotation } from "./types"

export interface PreferenceEvaluator {
  readonly name: string
  evaluate(annotation: EpistemicAnnotation): number
}
