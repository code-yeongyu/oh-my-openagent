import type { HostSessionIdentity } from "./handle-port"
import type { HostSessionReplaced } from "./session-client"

/**
 * The one mutable identity a host-session handle follows. The session PATH is the child's identity:
 * the routing handle is re-minted on every reopen and the instance id rotates on a handoff, so only
 * the path survives. A `session_replaced` moves that path (and the durable session id) while the
 * host keeps the routing handle live - the child follows instead of dying with the old transcript.
 */
export interface HandleSessionIdentity {
  readonly current: () => HostSessionIdentity
  readonly durableId: () => string | undefined
  readonly adopt: (next: HostSessionIdentity) => void
  readonly observeDurableId: (id: string) => void
  /** Apply a replacement the host pushed and answer it, so the handle can fan it out in one expression. */
  readonly followReplace: (event: HostSessionReplaced) => HostSessionReplaced
}

export function createHandleSessionIdentity(initial: HostSessionIdentity): HandleSessionIdentity {
  let session = initial
  let durableId: string | undefined
  return {
    current: () => session,
    durableId: () => durableId,
    adopt: (next) => {
      session = next
    },
    observeDurableId: (id) => {
      durableId = id
    },
    followReplace: (event) => {
      session = { ...session, sessionPath: event.sessionFile }
      durableId = event.durableSessionId
      return event
    },
  }
}
