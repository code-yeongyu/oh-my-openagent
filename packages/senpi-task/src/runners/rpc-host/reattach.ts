import type { HostSessionIdentity, HostSessionPort } from "./handle-port"

/**
 * What a reattach produced: a fresh port on the daemon (a new connection, possibly a new host
 * generation) bound to the SAME session path. `attached` is the host's word: true when the session
 * was still live and this open re-joined it, false when the host reopened it from its JSONL.
 */
export interface HostSessionReattached {
  readonly client: HostSessionPort
  readonly session: HostSessionIdentity
  readonly attached: boolean
}

/**
 * The runner's side of transport recovery: re-ensure the daemon and reopen this session by path.
 * Resolves undefined when the retries are exhausted; the handle then ends the child as it always
 * did (`crashed`, `transport_gone`). Never throws.
 */
export type HostSessionReattach = (session: HostSessionIdentity) => Promise<HostSessionReattached | undefined>

/** A command met a dead transport: the senpi client's loss error, or the session client already emptied. */
export function isTransportLossError(error: unknown): boolean {
  if (!(error instanceof Error) || !("code" in error)) return false
  return error.code === "rpc_transport_gone" || error.code === "session_detached"
}

export const HOST_SESSION_REATTACH_TAG = "[host-session-reattach]"

export function reattachContinuationPrompt(): string {
  return `${HOST_SESSION_REATTACH_TAG} The connection to your session host was lost mid-turn and has been restored; the session was reopened from its transcript. Continue the work you were doing from where the transcript ends. Do not repeat completed steps.`
}
