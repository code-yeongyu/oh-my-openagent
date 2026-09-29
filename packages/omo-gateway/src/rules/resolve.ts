// Scope resolution for conversation rules (Design record "Conversation rules layer").
//
// Precedence, most specific first: thread > chat > surface > gateway-wide. At the same location
// level a user rule of the requester beats a participant's user rule, which beats a rule with no
// user. Per gate the most specific rule wins unless a rule is `locked`: then the broadest locked
// rule wins, so an owner lock cannot be overridden by any narrower scope. Ties go to the rule
// whose file was committed most recently (`seq`, larger = newer).

import { GATE_IDS, PER_KEY_GATES, type GateId, type GateParams } from "./gates"
import type { RuleAudience, RuleRecord } from "./format"

export interface RuleCandidate {
  readonly rule: RuleRecord
  readonly seq: number
}

export interface ResolveTarget {
  readonly gateway: string
  readonly surface?: string | null
  readonly chat?: string | null
  readonly thread?: string | null
  readonly requester?: string | null
  readonly participants?: readonly string[]
  readonly audience?: RuleAudience
  readonly agent?: string | null
}

export interface ResolvedGate {
  readonly params: GateParams
  readonly rules: readonly RuleRecord[]
}

export interface ResolvedRules {
  readonly gates: ReadonlyMap<GateId, ResolvedGate>
  readonly behavioral: readonly RuleCandidate[]
}

interface Ranked extends RuleCandidate {
  readonly rank: number
}

function fieldMatches(ruleValue: string | null, targetValue: string | null | undefined): boolean {
  return ruleValue === null || ruleValue === (targetValue ?? null)
}

function userRank(user: string | null, target: ResolveTarget): number | null {
  if (user === null) return 0
  if (user === target.requester) return 2
  if (target.participants?.includes(user) === true) return 1
  return null
}

function locationLevel(rule: RuleRecord): number {
  if (rule.scope.thread !== null) return 3
  if (rule.scope.chat !== null) return 2
  if (rule.scope.surface !== null) return 1
  return 0
}

function rankFor(rule: RuleRecord, target: ResolveTarget): number | null {
  const { scope } = rule
  if (scope.gateway !== target.gateway) return null
  if (!fieldMatches(scope.surface, target.surface)) return null
  if (!fieldMatches(scope.chat, target.chat)) return null
  if (!fieldMatches(scope.thread, target.thread)) return null
  if (scope.agent !== null && scope.agent !== target.agent && scope.agent !== target.audience) return null
  if (target.audience !== undefined && !rule.applies_to.includes(target.audience)) return null
  const user = userRank(scope.user, target)
  if (user === null) return null
  return locationLevel(rule) * 3 + user
}

function applicable(candidates: readonly RuleCandidate[], target: ResolveTarget): Ranked[] {
  const superseded = new Set<string>()
  for (const { rule } of candidates) {
    if (rule.status === "active" && rule.supersedes !== null) superseded.add(rule.supersedes)
  }
  const ranked: Ranked[] = []
  for (const candidate of candidates) {
    if (candidate.rule.status !== "active" || superseded.has(candidate.rule.id)) continue
    const rank = rankFor(candidate.rule, target)
    if (rank !== null) ranked.push({ ...candidate, rank })
  }
  return ranked
}

function pickWinner(contenders: readonly Ranked[]): Ranked | undefined {
  const locked = contenders.filter((entry) => entry.rule.locked)
  const pool = locked.length > 0 ? locked : contenders
  const preferBroad = locked.length > 0
  let winner: Ranked | undefined
  for (const entry of pool) {
    if (winner === undefined) {
      winner = entry
      continue
    }
    const better = preferBroad ? entry.rank < winner.rank : entry.rank > winner.rank
    if (better || (entry.rank === winner.rank && entry.seq > winner.seq)) winner = entry
  }
  return winner
}

function resolvePerKey(contenders: readonly Ranked[]): ResolvedGate {
  const keys = new Set(contenders.flatMap((entry) => Object.keys(entry.rule.params ?? {})))
  const params: Record<string, unknown> = {}
  const rules: RuleRecord[] = []
  for (const key of keys) {
    const winner = pickWinner(contenders.filter((entry) => Object.hasOwn(entry.rule.params ?? {}, key)))
    if (winner === undefined) continue
    params[key] = winner.rule.params?.[key]
    if (!rules.includes(winner.rule)) rules.push(winner.rule)
  }
  return { params, rules }
}

export function resolveRules(candidates: readonly RuleCandidate[], target: ResolveTarget): ResolvedRules {
  const ranked = applicable(candidates, target)
  const gates = new Map<GateId, ResolvedGate>()
  for (const gate of GATE_IDS) {
    const contenders = ranked.filter((entry) => entry.rule.kind === "mechanical" && entry.rule.gate === gate)
    if (contenders.length === 0) continue
    if (PER_KEY_GATES.has(gate)) {
      gates.set(gate, resolvePerKey(contenders))
      continue
    }
    const winner = pickWinner(contenders)
    if (winner !== undefined) gates.set(gate, { params: winner.rule.params ?? {}, rules: [winner.rule] })
  }
  const behavioral = ranked
    .filter((entry) => entry.rule.kind === "behavioral")
    .sort((left, right) => right.rank - left.rank || right.seq - left.seq)
    .map(({ rule, seq }) => ({ rule, seq }))
  return { gates, behavioral }
}
