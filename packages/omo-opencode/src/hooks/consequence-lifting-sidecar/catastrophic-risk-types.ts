import type { RiskThreshold } from "./tag-contract"

export type CatastrophicLevel = "none" | "elevated" | "catastrophic"

export interface CatastrophicClassification {
  conclusion: string
  level: CatastrophicLevel
  catastrophicGated: boolean
  threshold: RiskThreshold | null
  reasons: string[]
}
