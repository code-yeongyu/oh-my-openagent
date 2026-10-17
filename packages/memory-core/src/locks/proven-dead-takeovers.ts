import type { LockRecord } from "./lock-record"

// In-process evidence of dead-owner takeovers, keyed by lock path. The lock protocol is the only
// component that can prove a previous owner died (pid + start identity, see stale-owner.ts), and
// that proof exists at takeover time, in the process that performed it - the lock file itself is
// overwritten by the new holder, so the dead owner's record would otherwise be unrecoverable by
// the time a later consumer (the stranded-git-lock sweep) needs to justify reclamation.
//
// omo #10199 r5 MEDIUM 3: the proof is bound to ONE acquisition - the nonce of the record that
// was published after the takeover - and is forgotten when that acquisition ends. A later
// acquisition of the same lock, or any other lock, never inherits it.
type ProvenDeadTakeover = { readonly previous: LockRecord; readonly takeoverNonce: string }

const provenDeadTakeovers = new Map<string, ProvenDeadTakeover>()

export function recordProvenDeadTakeover(lockPath: string, previousOwner: LockRecord, takeoverNonce: string): void {
  provenDeadTakeovers.set(lockPath, { previous: previousOwner, takeoverNonce })
}

export function provenDeadTakeoverFor(lockPath: string, acquisitionNonce: string): LockRecord | undefined {
  const entry = provenDeadTakeovers.get(lockPath)
  return entry?.takeoverNonce === acquisitionNonce ? entry.previous : undefined
}

export function forgetProvenDeadTakeover(lockPath: string, acquisitionNonce: string): void {
  if (provenDeadTakeovers.get(lockPath)?.takeoverNonce === acquisitionNonce) provenDeadTakeovers.delete(lockPath)
}
