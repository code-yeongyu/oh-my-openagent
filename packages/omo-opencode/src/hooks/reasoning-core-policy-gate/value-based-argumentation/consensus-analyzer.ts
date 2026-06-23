export interface ConsensusInput {
  audience_id: string
  extension_signature: string
}

export function analyzeAudienceConsensus(
  results: ConsensusInput[]
): "unanimous" | "majority" | "split" {
  if (results.length <= 1) {
    return "unanimous"
  }

  const counts = new Map<string, number>()
  for (const result of results) {
    counts.set(result.extension_signature, (counts.get(result.extension_signature) ?? 0) + 1)
  }

  if (counts.size === 1) {
    return "unanimous"
  }

  const threshold = Math.floor(results.length / 2) + 1
  for (const count of counts.values()) {
    if (count >= threshold) {
      return "majority"
    }
  }

  return "split"
}
