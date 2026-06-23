type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function extractUnderminedPremises(conclusions: unknown): string[] {
  if (!isRecord(conclusions)) {
    return []
  }

  const premises = new Set<string>()

  for (const entry of Object.values(conclusions)) {
    if (!isRecord(entry) || !Array.isArray(entry.attacks)) {
      continue
    }

    for (const attack of entry.attacks) {
      if (!isRecord(attack) || attack.kind !== "undermine" || typeof attack.target !== "string") {
        continue
      }

      premises.add(attack.target)
    }
  }

  return [...premises]
}

export function extractUndercutRules(conclusions: unknown): string[] {
  if (!isRecord(conclusions)) {
    return []
  }

  const rules = new Set<string>()

  for (const entry of Object.values(conclusions)) {
    if (!isRecord(entry) || !Array.isArray(entry.attacks)) {
      continue
    }

    for (const attack of entry.attacks) {
      if (!isRecord(attack) || attack.kind !== "undercut" || typeof attack.undercut_rule !== "string") {
        continue
      }

      rules.add(attack.undercut_rule)
    }
  }

  return [...rules]
}
