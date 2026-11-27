import type { RemoteThreadSurface } from "../thread/remote/ports"
import { remoteAvailable } from "../thread/remote/remote-ops"

/**
 * The relay-first check every `omo remote` session verb and attach answers before it resolves anything (#14305 delta
 * review H1): a device service that is off, signed out, not set up or on a plan without the relay is host_unavailable
 * (relay_requires_paid_plan) naming its state; undefined when the relay is connected. It reads only the account state of
 * the surface's client (thread/address accountState), so the address module never reads those states as an empty book.
 */
export const relayUnavailable = (surface: RemoteThreadSurface): ReturnType<typeof remoteAvailable> =>
  remoteAvailable(surface)
