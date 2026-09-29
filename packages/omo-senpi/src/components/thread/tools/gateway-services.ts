import { toGatewayAddressEntries } from "../address-book"
import type { GatewayEndpointPort, GatewayEndpointRef } from "../gateway/adapter"
import { createGatewayEngine, resolveFromEntries, type GatewayEngine } from "../gateway/engine"
import { createGatewayRelay, type GatewayRelay } from "../gateway/relay"
import { createGatewayStore, type GatewayStore } from "../gateway/store"
import { addressBook } from "./internals"
import type { ThreadHostView, ThreadToolSurfaceOptions } from "./ports"

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
 * The one composition of the gateway over a thread surface: the store (the options' store, else one
 * under `stateDirectory`), the engine resolving addresses through the address book of `view`, and
 * the relay. The agent tools and the `omo thread` SDK both build on it, so neither duplicates the
 * engine; they differ only in the principal they pass.
 */
export function createGatewayServices(options: ThreadToolSurfaceOptions, view: () => Promise<ThreadHostView>): GatewayServices {
  const now = options.now ?? Date.now
  const store = options.store ?? createGatewayStore({ agentDir: options.stateDirectory })
  const endpoints = options.host.gateway ?? UNREACHABLE
  const entries = async () => toGatewayAddressEntries(addressBook(options, await view()))
  const engine = createGatewayEngine({ store, endpoints, resolve: resolveFromEntries(entries, options.callerWorkspaceRoot), now })
  const locate = async (durableId: string): Promise<GatewayEndpointRef | null> => {
    const entry = (await entries()).find((candidate) => candidate.thread_id === durableId)
    return entry === undefined || entry.liveness !== "routable" ? null : entry.endpoint
  }
  const relay = createGatewayRelay({ store, engine, endpoints, locate, now })
  return { store, endpoints, engine, relay, locate }
}
