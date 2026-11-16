import { type ClientCore, notYet, type RemoteClient } from "./client"

/**
 * `sessions.resolve` (unit U5 of #13414): one address (durable id, alias, name, `<device>/<session>`) to its row on the
 * cached listing revision, with no relist per operation. Stub until U5 lands.
 */
export function resolveMember(_core: ClientCore): RemoteClient["sessions"]["resolve"] {
  return async () => notYet("sessions.resolve")
}
