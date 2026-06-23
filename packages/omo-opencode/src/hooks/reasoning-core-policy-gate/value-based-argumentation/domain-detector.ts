import type { AudienceDomain } from "./audience-categories"

const DOMAIN_KEYWORDS: Array<{ domain: AudienceDomain; keywords: string[] }> = [
  { domain: "healthcare", keywords: ["patient", "hospital", "diagnosis", "treatment", "clinical", "medical"] },
  { domain: "legal", keywords: ["court", "judge", "precedent", "statute", "legal", "client", "filing"] },
  { domain: "finance", keywords: ["capital", "portfolio", "market", "trading", "financial", "liquidity", "credit"] },
]

export function detectDomain(problemStatement: string): AudienceDomain {
  const normalized = problemStatement.toLowerCase()

  for (const entry of DOMAIN_KEYWORDS) {
    if (entry.keywords.some((keyword) => normalized.includes(keyword))) {
      return entry.domain
    }
  }

  return "general"
}
