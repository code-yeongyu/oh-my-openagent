import type { ValueDimension } from "./values-schema"

export type AudienceDomain = "healthcare" | "legal" | "finance" | "general"
export type AudienceCategory = "domain-specific" | "universal"

export interface AudienceDefinition {
  id: string
  label: string
  category: AudienceCategory
  domains?: AudienceDomain[]
  value_ordering: ValueDimension[]
}

const UNIVERSAL_AUDIENCES: AudienceDefinition[] = [
  {
    id: "risk_averse",
    label: "Risk Averse",
    category: "universal",
    value_ordering: ["safety", "justice", "transparency", "autonomy"],
  },
  {
    id: "autonomy_maximizer",
    label: "Autonomy Maximizer",
    category: "universal",
    value_ordering: ["autonomy", "dignity", "transparency", "safety"],
  },
  {
    id: "ethical_deontological",
    label: "Ethical Deontological",
    category: "universal",
    value_ordering: ["justice", "dignity", "safety", "autonomy", "cost_efficiency"],
  },
  {
    id: "machiavellian",
    label: "Machiavellian",
    category: "universal",
    value_ordering: ["task_completion", "autonomy", "cost_efficiency", "transparency", "dignity", "justice", "safety"],
  },
]

const DOMAIN_AUDIENCES: AudienceDefinition[] = [
  {
    id: "healthcare_clinician",
    label: "Healthcare Clinician",
    category: "domain-specific",
    domains: ["healthcare"],
    value_ordering: ["safety", "beneficence", "autonomy", "cost_efficiency"],
  },
  {
    id: "legal_formalist",
    label: "Legal Formalist",
    category: "domain-specific",
    domains: ["legal"],
    value_ordering: ["precedent_integrity", "justice", "transparency", "autonomy"],
  },
  {
    id: "financial_operator",
    label: "Financial Operator",
    category: "domain-specific",
    domains: ["finance"],
    value_ordering: ["cost_efficiency", "transparency", "justice", "safety"],
  },
]

export function getAudiencesForDomain(domain: AudienceDomain): AudienceDefinition[] {
  const domainAudiences = DOMAIN_AUDIENCES.filter((audience) => audience.domains?.includes(domain))
  return [...domainAudiences, ...UNIVERSAL_AUDIENCES]
}
