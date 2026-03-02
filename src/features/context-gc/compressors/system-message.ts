import type { GcPart } from "../types"
import type { Tier } from "../tier-classifier"
import { estimateTokens } from "../token-budget"

const KEEP_PATTERNS = [
  /constraint/i,
  /NEVER\b/,
  /MUST\b/,
  /CRITICAL/i,
  /bootstrap/i,
  /identity/i,
]

type SystemPartModification = {
  partIndex: number
  action: "remove"
}

function isBootstrapOrConstraint(text: string): boolean {
  return KEEP_PATTERNS.some((pattern) => pattern.test(text))
}

export function computeSystemModifications(
  parts: GcPart[],
  tier: Tier,
): SystemPartModification[] {
  if (tier === "hot" || tier === "warm") {
    return []
  }

  const modifications: SystemPartModification[] = []

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (part.type !== "text") {
      continue
    }

    const text = part.text ?? ""

    if (isBootstrapOrConstraint(text)) {
      continue
    }

    if (part.synthetic === true && estimateTokens(text) > 200) {
      modifications.push({ partIndex: i, action: "remove" })
    }
  }

  return modifications
}
