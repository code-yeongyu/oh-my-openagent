export type RecourseLevel = "reversible" | "partially_reversible" | "irreversible"

export interface VOIResult {
  score: number
  deferRecommended: boolean
  recourseLevel: RecourseLevel
  reasons: string[]
}
