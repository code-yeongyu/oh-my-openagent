import { GUIDANCE_MAX_ENTRIES, type ControlGuidance, type ControlRegister } from "./control-schema"

// The one total order a register moves along (design 3.1): run epoch first, then a sticky
// `cancelled` above everything in its epoch, then (pauseSeq, paused < resumed).
function compareRegisters(a: ControlRegister, b: ControlRegister): number {
  if (a.runEpoch !== b.runEpoch) return a.runEpoch - b.runEpoch
  const aCancelled = a.phase === "cancelled"
  const bCancelled = b.phase === "cancelled"
  if (aCancelled || bCancelled) return Number(aCancelled) - Number(bCancelled)
  if (a.pauseSeq !== b.pauseSeq) return a.pauseSeq - b.pauseSeq
  return Number(a.phase === "resumed") - Number(b.phase === "resumed")
}

function mergeGuidance(...lists: readonly (readonly ControlGuidance[] | undefined)[]): readonly ControlGuidance[] {
  const byId = new Map<string, ControlGuidance>()
  for (const list of lists) for (const entry of list ?? []) {
    const prior = byId.get(entry.inputId)
    if (prior === undefined || entry.revision > prior.revision) byId.set(entry.inputId, entry)
  }
  return [...byId.values()]
}

export type RegisterMerge =
  | { readonly kind: "merged"; readonly register: ControlRegister; readonly changed: boolean }
  | { readonly kind: "guidance_too_large" }

const comparable = ({ writtenAt: _at, requester: _requester, ...rest }: ControlRegister): string => JSON.stringify(rest)

// Nothing lower is written over something higher; guidance merges by inputId (highest revision)
// within one epoch and is carried across a seq move until an ack reports its outcome.
export function mergeRegister(prior: ControlRegister | undefined, incoming: ControlRegister): RegisterMerge {
  if (prior === undefined) return { kind: "merged", register: incoming, changed: true }
  const winner = compareRegisters(incoming, prior) > 0 ? incoming : prior
  const guidance = prior.runEpoch === incoming.runEpoch ? mergeGuidance(prior.guidance, incoming.guidance) : winner.guidance ?? []
  if (guidance.length > GUIDANCE_MAX_ENTRIES) return { kind: "guidance_too_large" }
  const { guidance: _dropped, ...base } = winner
  const register: ControlRegister = { ...base, ...(guidance.length === 0 ? {} : { guidance }),
    ...(winner === prior ? { requester: incoming.requester, writtenAt: incoming.writtenAt } : {}) }
  return { kind: "merged", register, changed: comparable(register) !== comparable(prior) }
}
