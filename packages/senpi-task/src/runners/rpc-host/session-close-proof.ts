import type { HostRpcClient } from "./session-transport"
import { HostSessionDetachedError, HostSessionUnresponsiveError } from "./session-wire"

/** A close acknowledgement may only detach our attachment; the host's live table owns absence. */
export async function confirmHostSessionAbsent(
  client: HostRpcClient,
  routingId: string,
  connected: () => boolean,
): Promise<void> {
  const closeError: unknown = await client.closeSession(routingId).then(
    () => undefined,
    (error: unknown) => error,
  )
  if (!connected()) throw new HostSessionDetachedError("confirm close_session")
  if (client.listSessions === undefined) throw closeError ?? new HostSessionUnresponsiveError()
  // Even a refused or lost acknowledgement may follow an actual close. Query AFTER that attempt.
  const sessions = await client.listSessions({ include_workers: true })
  if (!connected()) throw new HostSessionDetachedError("confirm close_session")
  if (sessions.some(session => session.sessionId === routingId)) throw closeError ?? new HostSessionUnresponsiveError()
}
