export const TAG_RISK_CATASTROPHIC = /@risk:catastrophic:(mortality_high|mortality_critical|unbounded_tail|identity_loss)/
export const TAG_CONTAM_COI = /@contam:coi:([^\s]+)/
export const TAG_CONTAM_SEVERANCE = /@contam:severance:(evidentiary|procedural|methodological)/
export const TAG_VALENCE_HARM = /@valence:harm:(mild|moderate|severe|critical)/
export const TAG_VALENCE_BENEFIT = /@valence:benefit:(mild|moderate|severe|critical)/
export const TAG_OPTION = /@option:([^\s]+)/
export const TAG_DECISION = /@decision:([^\s]+)/
export const TAG_VALUE = /@value:([a-z_]+)/

export type RiskThreshold = "mortality_high" | "mortality_critical" | "unbounded_tail" | "identity_loss"
export type ContamAxis = "coi" | "severance"
export type SeveranceType = "evidentiary" | "procedural" | "methodological"
export type ValenceSeverity = "mild" | "moderate" | "severe" | "critical"
// Valid dimensions: safety, autonomy, transparency, cost_efficiency, precedent_integrity, beneficence, justice, dignity
export type ValueDimension = string
