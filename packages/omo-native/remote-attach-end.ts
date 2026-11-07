import type { AttachEnd } from "../device-service-core/src/index.ts"
import { REMOTE_EXIT } from "./remote-exit"

/** How `omo remote attach` ends when the remote side ended the attach: what the user is told, and the exit code. */
export type RemoteAttachEnded = { readonly reason: AttachEnd; readonly exitCode: number; readonly message: string }

// The host closing or replacing the session is the session's own end, so the command succeeds. peer_detached counts
// as one too: the relay daemon reports session_closed only to clients its version gate knows, and every other client
// (this one included, until that gate names it) gets peer_detached for a session another client closed.
const SESSION_ENDS: ReadonlySet<AttachEnd> = new Set(["session_closed", "session_replaced", "peer_detached"])

export function attachEnded(label: string, reason: AttachEnd): RemoteAttachEnded {
  return {
    reason,
    exitCode: SESSION_ENDS.has(reason) ? REMOTE_EXIT.ok : REMOTE_EXIT.failed,
    message: `The remote session ${label} ended (${reason}).`,
  }
}
