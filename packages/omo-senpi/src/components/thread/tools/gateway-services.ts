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

/** The store-free live-and-disk resolver for extension calls, which run inside the store worker's transaction. */
export function createGatewayResolver(options: Omit<ThreadToolSurfaceOptions, "store">, view: () => Promise<ThreadHostView>): GatewayResolve {
  return async (address, request) => {
    const current = await view()
    return await resolveFromEntries(() => toGatewayAddressEntries(sendAddressBook(options, current, address, request.all_scope)), options.callerWorkspaceRoot)(address, request)
  }
}

/**
 * The one composition of the gateway over a thread surface: the caller's store, the engine resolving addresses through the address book of `view`, and
 * the relay. The agent tools and the `omo thread` SDK both build on it, so neither duplicates the
 * engine; they differ only in the principal they pass. `view` is the send path's view (callers pass
 * one that answers even when nothing is live): a target no endpoint lists resolves from disk
 * (`sendAddressBook`) and is queued offline.
 */
export function createGatewayServices(options: ThreadToolSurfaceOptions, view: () => Promise<ThreadHostView>): GatewayServices {
  // The SDK and tools send through a fresh `list_sessions` on only the target's socket (#9222's
  // single-lookup rule); the extension path shares the plain live-and-disk resolver (no store).
  const resolve: GatewayResolve = async (address, request) => {
    const current = await sendView(options, address, view)
    return await resolveFromEntries(() => toGatewayAddressEntries(sendAddressBook(options, current, address, request.all_scope)), options.callerWorkspaceRoot)(address, request)
  }
  const store = options.store
  const now = options.now ?? store.now
  const endpoints = options.host.gateway ?? UNREACHABLE
  const entries = async () => toGatewayAddressEntries(addressBook(options, await view()))
  const engine = createGatewayEngine({ store, endpoints, resolve, now })
  const locate = async (durableId: string): Promise<GatewayEndpointRef | null> => {
    const entry = (await entries()).find((candidate) => candidate.thread_id === durableId)
    return entry === undefined || entry.liveness !== "routable" ? null : entry.endpoint
  }
  const relay = createGatewayRelay({ store, engine, endpoints, locate, now })
  return { store, endpoints, engine, relay, locate }
}
