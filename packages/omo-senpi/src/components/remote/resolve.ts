import type { RemoteClient } from "./client"
import { type ClientCore, notYet } from "./core"

/**
 * `sessions.resolve` (unit U5 of #13414): one address (durable id, alias, name, `<device>/<session>`) to its row on the
 * cached listing revision, with no relist per operation. Stub until U5 lands.
 */
export function resolveMember(_core: ClientCore): RemoteClient["sessions"]["resolve"] {
  return async () => notYet("sessions.resolve")
}
