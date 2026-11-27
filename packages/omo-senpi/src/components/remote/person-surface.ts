import type { RemoteThreadSurface } from "../thread/remote/ports"
import type { RemoteClient } from "./client"
import { remoteSessionsPort } from "./port/sessions-port"

/**
 * Seam 5 (#13414 4c-2): the thread surface over a person client, for the one typed-address resolver (resolveTypedAddress
 * reads a RemoteThreadSurface) and the relay check. Its sessions port borrows the client's shared connection and dials
 * its own only for an open, so it never closes the client's; the caller closes the port (its attach pool's timers) and
 * then the client. A person at a terminal is no thread chain: records pass unstamped.
 */
export const personSurface = (client: RemoteClient, version: string): RemoteThreadSurface => ({
  client,
  sessions: remoteSessionsPort(version, client),
  chain: { stamp: (record) => record },
})
