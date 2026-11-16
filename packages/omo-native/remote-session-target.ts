import { threadToolFailure } from "../omo-senpi/src/components/thread/errors"
import { namedDeviceRow } from "../omo-senpi/src/components/thread/remote/address-book"
import { outcomeFailure } from "../omo-senpi/src/components/thread/remote/outcome"
import type { RemoteSessionRow, RemoteThreadSurface } from "../omo-senpi/src/components/thread/remote/ports"
import type { RemoteSessionTarget } from "./remote-session-args"

/**
 * Resolve the CLI's durable identity to the relay's private attach key. An explicit device uses its locate,
 * never an account-wide listing. A bare durable id needs the account listing to discover its device.
 */
export async function resolveSessionTarget(remote: RemoteThreadSurface, target: RemoteSessionTarget) {
  const { device, session } = target
  if (device !== undefined) {
    const row = namedDeviceRow(device, session)
    const located = await remote.sessions.locate(device, session)
    if (located.kind === "ok") return { kind: "ok" as const, row: { ...row, session_id: located.sessionId } }
    if (located.reason !== "session_not_found" && located.reason !== "unsupported")
      return outcomeFailure(located, device)
    // A listing key is already an attach address; a durable-id probe cannot find it. The device's attach still
    // decides whether that key exists. A service without locate can still attach a listing key directly.
    return { kind: "ok" as const, row }
  }
  const matches: readonly RemoteSessionRow[] = (await remote.sessions.sessions()).filter(
    (row) => row.durable_id === session,
  )
  const [row] = matches
  if (row !== undefined && matches.length === 1) return { kind: "ok" as const, row }
  return {
    kind: "error" as const,
    error: threadToolFailure(
      row === undefined ? "not_found" : "ambiguous_target",
      row === undefined ? `No session ${session} on this account.` : `More than one device holds session ${session}.`,
      row === undefined ? "Run omo remote sessions to see them." : "Address the session as <device>/<session>.",
      { thread_id: session },
    ),
  }
}
