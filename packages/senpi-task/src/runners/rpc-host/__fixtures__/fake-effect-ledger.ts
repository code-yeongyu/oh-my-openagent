/**
 * The fake daemon's effect ledger (senpi `effect_ledger`): one receipt per `effectId` per session
 * transcript, newest state wins, and a same-id retry replays the stored receipt instead of acting
 * twice. Receipts are keyed by session PATH, not routing id, because the real ledger lives in the
 * transcript: an unloaded session still answers `get_effect_status { sessionPath }`.
 */

export type FakeEffectKind = "input" | "abort" | "unload" | "set_model" | "set_thinking_level" | "dequeue" | "edit_queued"
export type FakeEffectState = "accepted" | "applied" | "done" | "failed"

export interface FakeEffect {
  readonly effectId: string
  readonly kind: FakeEffectKind
  readonly state: FakeEffectState
  readonly durableSessionId: string
  readonly disposition?: string
  readonly outcome?: Readonly<Record<string, unknown>>
}

export class FakeEffectLedger {
  private readonly receipts = new Map<string, FakeEffect>()

  record(sessionPath: string, effect: FakeEffect): FakeEffect {
    this.receipts.set(ledgerKey(sessionPath, effect.effectId), effect)
    return effect
  }

  find(sessionPath: string, effectId: string): FakeEffect | undefined {
    return this.receipts.get(ledgerKey(sessionPath, effectId))
  }
}

function ledgerKey(sessionPath: string, effectId: string): string {
  return `${sessionPath}\0${effectId}`
}

export function effectAnswer(effect: FakeEffect): Readonly<Record<string, unknown>> {
  return { effectId: effect.effectId, state: effect.state, effect }
}
