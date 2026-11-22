import { ULTRAWORK_DIRECTIVES } from "./directive-variants"

export interface ArmingSnapshot {
  readonly wasArmed: boolean
  readonly compactRearmPending: boolean
}

export interface SessionArming {
  trackSession(sessionId: string | undefined): void
  currentSessionId(): string | undefined
  rearmOnCompact(sessionId: string | undefined): void
  isArmed(sessionId: string | undefined): boolean
  isCompactRearmPending?(sessionId: string | undefined): boolean
  markArmed(sessionId: string | undefined): void
}

// Senpi tears down the extension runner and re-registers every component during
// a session switch or resume, and it loads PACKAGED extensions through an
// uncached importer (Jiti `moduleCache: false` in core/extensions/loader.ts), so
// every module-scope binding in this bundle is reconstructed on each load. A
// ledger held at module scope — or inside register() — forgets every armed
// session there and re-injects the full ~17KB directive on the next trigger, the
// exact token burn this guard exists to stop. The default ledger therefore hangs
// off globalThis (process-lifetime, survives re-evaluation), keyed by a
// registered symbol so every evaluation of the bundle shares one ledger — but
// ONLY while the directive text matches exactly: a slot left by an older bundle
// armed its sessions against a directive their transcripts may no longer hold,
// so a directive mismatch must start a fresh ledger, not reuse the stale one.
// Tests inject isolated ledgers through the factory parameter instead.
const ARMING_LEDGER_KEY = Symbol.for("omo.ultrawork.arming")

interface SharedArmingSlot {
  readonly directives: readonly string[]
  readonly arming: SessionArming
}

function isCurrentArmingSlot(value: unknown): value is SharedArmingSlot {
  if (typeof value !== "object" || value === null) {
    return false
  }
  const slot = value as SharedArmingSlot
  // The slot stores every variant's directive TEXT itself, not a hash: string `===` compares
  // by value, so a re-evaluated bundle's fresh constants still match, while any
  // edit to a directive (or a hash collision between distinct directives, which
  // a 32-bit FNV-1a revision demonstrably allowed) can never reuse stale arming.
  // A bare ledger from a pre-slot bundle, or a slot from a bundle with another set
  // of variants, has no matching texts, so it is discarded exactly like an edited one.
  const current = Object.values(ULTRAWORK_DIRECTIVES)
  return (
    Array.isArray(slot.directives) &&
    slot.directives.length === current.length &&
    current.every((directive, index) => slot.directives[index] === directive) &&
    typeof slot.arming === "object" &&
    slot.arming !== null
  )
}

export function sharedSessionArming(): SessionArming {
  const registry = globalThis as unknown as Record<symbol, unknown>
  const existing = registry[ARMING_LEDGER_KEY]
  if (isCurrentArmingSlot(existing)) {
    return existing.arming
  }
  const created = createSessionArming()
  const slot: SharedArmingSlot = { directives: Object.values(ULTRAWORK_DIRECTIVES), arming: created }
  registry[ARMING_LEDGER_KEY] = slot
  return created
}

export function armingSnapshot(sessionId: string | undefined): ArmingSnapshot {
  const registry = globalThis as unknown as Record<symbol, unknown>
  const existing = registry[ARMING_LEDGER_KEY]
  if (!isCurrentArmingSlot(existing)) {
    return { wasArmed: false, compactRearmPending: false }
  }
  return snapshotSessionArming(existing.arming, sessionId)
}

/**
 * Once-per-session arming ledger. The full directive rides in on a session's FIRST
 * trigger; later triggers in that same session get the short reminder because the
 * transcript already holds every rule. Only an accepted compaction re-arms a
 * session (its transcript loses the directive block there). Switching sessions
 * never re-arms: a session switched back into still holds its directive, and
 * deleting the id on switch would recreate the per-turn accumulation this guards
 * against. Hosts that expose no session id anywhere fall back to one anonymous
 * ledger slot, reset by the same compaction event.
 */
export function createSessionArming(): SessionArming {
  const armedSessionIds = new Set<string>()
  const compactRearmPendingSessionIds = new Set<string>()
  let currentSessionId: string | undefined
  let anonymousArmed = false
  let anonymousCompactRearmPending = false

  return {
    trackSession(sessionId) {
      currentSessionId = sessionId
    },
    currentSessionId() {
      return currentSessionId
    },
    rearmOnCompact(sessionId) {
      const target = sessionId ?? currentSessionId
      if (target === undefined) {
        anonymousArmed = false
        anonymousCompactRearmPending = true
        return
      }
      armedSessionIds.delete(target)
      compactRearmPendingSessionIds.add(target)
    },
    isArmed(sessionId) {
      if (sessionId === undefined) return anonymousArmed
      return armedSessionIds.has(sessionId)
    },
    isCompactRearmPending(sessionId) {
      if (sessionId === undefined) return anonymousCompactRearmPending
      return compactRearmPendingSessionIds.has(sessionId)
    },
    markArmed(sessionId) {
      if (sessionId === undefined) {
        anonymousArmed = true
        anonymousCompactRearmPending = false
        return
      }
      armedSessionIds.add(sessionId)
      compactRearmPendingSessionIds.delete(sessionId)
    },
  }
}

export function snapshotSessionArming(arming: SessionArming, sessionId: string | undefined): ArmingSnapshot {
  return {
    wasArmed: arming.isArmed(sessionId),
    compactRearmPending: arming.isCompactRearmPending?.(sessionId) ?? false,
  }
}
