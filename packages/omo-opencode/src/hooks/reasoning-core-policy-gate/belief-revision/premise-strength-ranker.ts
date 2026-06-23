interface RankedPremise {
  formula: string
  kind?: string
}

const PREMISE_STRENGTH = {
  assumption: 0,
  ordinary: 1,
  axiom: 2,
} as const

export function selectWeakestPremise(premises: RankedPremise[]): {
  index: number
  premise: RankedPremise
} | null {
  let weakest: { index: number; premise: RankedPremise; strength: number } | null = null

  for (const [index, premise] of premises.entries()) {
    const strength = getPremiseStrength(premise.kind)
    if (strength >= PREMISE_STRENGTH.axiom) {
      continue
    }
    if (weakest === null || strength < weakest.strength) {
      weakest = { index, premise, strength }
    }
  }

  return weakest ? { index: weakest.index, premise: weakest.premise } : null
}

function getPremiseStrength(kind?: string): number {
  const normalizedKind = kind?.trim().toLowerCase()
  if (normalizedKind === "assumption") {
    return PREMISE_STRENGTH.assumption
  }
  if (normalizedKind === "axiom") {
    return PREMISE_STRENGTH.axiom
  }
  return PREMISE_STRENGTH.ordinary
}
