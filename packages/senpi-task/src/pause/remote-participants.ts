import type { OwnerCannotApply } from "../control/requester-channel"
import type { PauseParticipant, PauseRegistry } from "./registry"

// A participant another live process (or a sibling manager here) holds: the run reaches it only
// through the control channel, so it is never `lost` and never ended from here (design 3.2).
export type RemoteResult = {
  readonly kind: "remote"
  readonly state: "owned_elsewhere" | "held_remote"
  readonly ownerPid: number
  readonly ackSeq?: number
  readonly childSeq?: number
  readonly reason?: OwnerCannotApply
}

export const REMOTE_DEADLINE_MS = 3_000

const REMOTE_STATES: ReadonlySet<PauseParticipant["state"]> = new Set(["owned_elsewhere", "held_remote"])
const NON_TERMINAL: ReadonlySet<PauseParticipant["state"]> = new Set(["pending", "held", "resuming", "lost", "owned_elsewhere", "held_remote"])

export function inRemoteClass(participant: PauseParticipant): boolean {
  return REMOTE_STATES.has(participant.state)
}

export function retriedAsRemote(participant: PauseParticipant, isRemote: boolean): boolean {
  return NON_TERMINAL.has(participant.state) && (inRemoteClass(participant) || participant.state === "lost" || isRemote)
}

// Writes a remote result over the participant, keeping any local cutoff it already had (finding r4-1b).
export function writeRemote(registry: PauseRegistry, parentSessionId: string, pauseSeq: number, key: string, result: RemoteResult): void {
  registry.update(parentSessionId, pauseSeq, key, {
    state: result.state, ownerPid: result.ownerPid, lostReason: undefined, reason: result.reason,
    ...(result.ackSeq === undefined ? {} : { remoteAckSeq: result.ackSeq }),
    ...(result.childSeq === undefined ? {} : { remoteChildSeq: result.childSeq }),
  })
}

export function remoteFailure(key: string, result: RemoteResult): { readonly key: string; readonly reason: string } | undefined {
  return result.reason === undefined ? undefined : { key, reason: `owner_cannot_apply: ${result.reason} (pid ${result.ownerPid})` }
}
