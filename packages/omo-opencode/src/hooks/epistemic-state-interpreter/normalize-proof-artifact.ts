function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function normalizeConclusions(conclusions: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(conclusions).map(([conclusion, entry]) => {
    if (!isRecord(entry)) {
      return [conclusion, entry]
    }

    return [
      conclusion,
      {
        ...entry,
        attacks: Array.isArray(entry.attacks) ? entry.attacks : [],
      },
    ]
  }))
}

export function normalizeProofArtifact(raw: unknown): unknown {
  if (!isRecord(raw)) return raw
  if (isRecord(raw.result)) {
    return {
      ...raw,
      result: {
        ...raw.result,
        conclusions: isRecord(raw.result.conclusions) ? normalizeConclusions(raw.result.conclusions) : raw.result.conclusions,
      },
    }
  }
  if ("conclusions" in raw && "extensions" in raw) {
    return {
      result: {
        ...raw,
        conclusions: isRecord(raw.conclusions) ? normalizeConclusions(raw.conclusions) : raw.conclusions,
      },
    }
  }
  return raw
}
