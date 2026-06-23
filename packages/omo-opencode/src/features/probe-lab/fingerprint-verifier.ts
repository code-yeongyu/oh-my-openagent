import type { ProbeStore } from "./sqlite-store"

export type FingerprintVerification = {
  fingerprint_id: string
  actual_ja3: string | null
  actual_ja4: string | null
  matched_expected: boolean
  detection_score: number
  anomalies: string[]
}

export async function verifyFingerprint(args: {
  store: ProbeStore
  fingerprintId: string
  testUrl: string
}): Promise<FingerprintVerification> {
  const profile = args.store.getFingerprintProfile(args.fingerprintId)
  if (!profile) throw new Error(`fingerprint not found: ${args.fingerprintId}`)
  const res = await fetch(args.testUrl, { headers: profile.user_agent ? { "user-agent": profile.user_agent } : undefined })
  const parsed: unknown = await res.json()
  const actualJa3 = readString(parsed, ["tls", "ja3_hash"])
  const actualJa4 = readString(parsed, ["tls", "ja4"])
    ?? readString(parsed, ["tls", "ja4_hash"])
  const expected = profile.tls_fingerprint
  const matched = expected != null && (expected === actualJa3 || expected === actualJa4)
  const score = expected == null ? 0.5 : matched ? 0 : 1
  args.store.updateFingerprintLastVerifiedAt(args.fingerprintId, Math.floor(Date.now() / 1000))
  args.store.recordFingerprintDetectionScore(args.fingerprintId, score)
  return {
    fingerprint_id: args.fingerprintId,
    actual_ja3: actualJa3,
    actual_ja4: actualJa4,
    matched_expected: matched,
    detection_score: score,
    anomalies: res.ok ? [] : [`http_status:${res.status}`],
  }
}

function readString(value: unknown, path: string[]): string | null {
  let current = value
  for (const part of path) {
    if (current == null || typeof current !== "object") return null
    current = (current as Record<string, unknown>)[part]
  }
  return typeof current === "string" ? current : null
}
