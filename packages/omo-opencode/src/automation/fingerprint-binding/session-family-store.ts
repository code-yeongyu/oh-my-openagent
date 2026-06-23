import type { FingerprintFamily } from "../fingerprint"

const familyBySessionId = new Map<string, FingerprintFamily>()

export function setSessionFamily(sessionId: string, family: FingerprintFamily): void {
  familyBySessionId.set(sessionId, family)
}

export function getSessionFamily(sessionId: string): FingerprintFamily | undefined {
  return familyBySessionId.get(sessionId)
}

export function clearSessionFamily(sessionId: string): void {
  familyBySessionId.delete(sessionId)
}

export function clearAllSessionFamilies(): void {
  familyBySessionId.clear()
}
