import { toGatewayAddressEntries } from "../address-book"
import type { GatewayEndpointPort, GatewayEndpointRef } from "../gateway/adapter"
import { createGatewayEngine, resolveFromEntries, type GatewayEngine, type GatewayResolve } from "../gateway/engine"
import { createGatewayRelay, type GatewayRelay } from "../gateway/relay"
import type { GatewayStore } from "../gateway/store"
import { addressBook, sendAddressBook } from "./internals"
import type { ThreadHostView, ThreadToolSurfaceOptions } from "./ports"
import { sendView } from "./send-view"

/** A host without the gateway port reaches no endpoint: every gateway send lands `queued_offline`. */
const UNREACHABLE: GatewayEndpointPort = {
  wake: async (endpoint) => {
    throw new Error(`host_unavailable:${endpoint.socket}`)
  },
}

export type GatewayServices = {
  readonly store: GatewayStore
  readonly endpoints: GatewayEndpointPort
  readonly engine: GatewayEngine
  readonly relay: GatewayRelay
  /** The endpoint serving a session right now, or null when nothing answers for it. */
  readonly locate: (durableId: string) => Promise<GatewayEndpointRef | null>
}

/**
 * The one composition of the gateway over a thread surface: the caller's store, the engine resolving addresses through the address book of `view`, and
 * the relay. The agent tools and the `omo thread` SDK both build on it, so neither duplicates the
 * engine; they differ only in the principal they pass. `view` is the send path's view (callers pass
 * one that answers even when nothing is live): a target no endpoint lists resolves from disk
 * (`sendAddressBook`) and is queued offline.
 */
export function createGatewayServices(options: ThreadToolSurfaceOptions, view: () => Promise<ThreadHostView>): GatewayServices {
  const store = options.store
  const now = options.now ?? store.now
  const endpoints = options.host.gateway ?? UNREACHABLE
  const entries = async () => toGatewayAddressEntries(addressBook(options, await view()))
  const resolve: GatewayResolve = async (address, request) => {
    const current = await sendView(options, address, view)
    return await resolveFromEntries(() => toGatewayAddressEntries(sendAddressBook(options, current, address, request.all_scope)), options.callerWorkspaceRoot)(address, request)
  }
  const engine = createGatewayEngine({ store, endpoints, resolve, now })
  const locate = async (durableId: string): Promise<GatewayEndpointRef | null> => {
    const entry = (await entries()).find((candidate) => candidate.thread_id === durableId)
    return entry === undefined || entry.liveness !== "routable" ? null : entry.endpoint
  }
  const relay = createGatewayRelay({ store, engine, endpoints, locate, now })
  return { store, endpoints, engine, relay, locate }
}
