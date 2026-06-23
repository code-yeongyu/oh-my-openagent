type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === "string"
}

function extractTargets(attacks: unknown, kind: string): string[] {
  if (!Array.isArray(attacks)) {
    return []
  }

  const targets = new Set<string>()

  for (const attack of attacks) {
    if (!isRecord(attack) || attack.kind !== kind || !isString(attack.target)) {
      continue
    }

    targets.add(attack.target)
  }

  return [...targets]
}

export function extractProofArtifactAttackMetadata(attacks: unknown): {
  rebuttedConclusions: string[]
  underminedPremises: string[]
  undercutRules: string[]
} {
  const undercutRules = new Set<string>()

  if (Array.isArray(attacks)) {
    for (const attack of attacks) {
      if (!isRecord(attack) || attack.kind !== "undercut") {
        continue
      }
      
      const rule = isString(attack.undercut_rule) ? attack.undercut_rule : (isString(attack.target) ? attack.target : null)
      if (rule) undercutRules.add(rule)
    }
  }

  return {
    rebuttedConclusions: extractTargets(attacks, "rebut"),
    underminedPremises: extractTargets(attacks, "undermine"),
    undercutRules: [...undercutRules],
  }
}
