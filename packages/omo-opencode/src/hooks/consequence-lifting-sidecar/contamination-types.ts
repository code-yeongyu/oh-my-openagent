export type ContaminationLevel = "none" | "low" | "medium" | "high"
export type ContaminationAxis = "world" | "framework" | "coi" | "severance" | "coi+severance"

export interface ContaminationResult {
  conclusion: string
  level: ContaminationLevel
  axis: ContaminationAxis | null
  reasons: string[]
}
