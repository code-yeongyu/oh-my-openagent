import type { SessionOpenRequest } from "../thread/control/session-host"
import type { ThreadSocketConnect } from "../thread/live-surface"
import type { ThreadHost } from "../thread/tools/ports"
import { defaultLocalThreadHost, openOnThisDevice } from "./sessions-local"
import { localSessionRows } from "./sessions-local-list"
import { localSessionMembers } from "./sessions-local-members"
import type { DeviceRow } from "./types"

/**
 * This device's own operator endpoint as the client reaches it (#13787): the device service's listing does not carry
 * the asking device's sessions and its relay cannot route to that device, so they are listed, opened and driven here.
 * It opens sockets, so it stays out of `omo remote`'s local-only graph (#13440): a caller outside that graph injects
 * `createLocalSessions()` as RemoteClientDeps.localSessions. `hostOn` is the endpoint, the engine's own by default.
 */
export const createLocalSessions = (
  hostOn: (connect: ThreadSocketConnect) => Promise<ThreadHost> = defaultLocalThreadHost,
) => ({
  rows: (self: DeviceRow) => localSessionRows(hostOn, self),
  open: (self: string, request: SessionOpenRequest) => openOnThisDevice(hostOn, self, request),
  members: localSessionMembers(hostOn),
})

export type LocalSessions = ReturnType<typeof createLocalSessions>
