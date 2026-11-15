import { toGatewayAddressEntries } from "../address-book"
import type { GatewayEndpointPort, GatewayEndpointRef } from "../gateway/adapter"
import { createGatewayEngine, resolveFromEntries, type GatewayEngine, type GatewayResolve } from "../gateway/engine"
import { createLocalTransport } from "../gateway/local-transport"
import { createDeliveryPipeline, type DeliveryPipeline } from "../gateway/pipeline"
import { createGatewayRelay, type GatewayRelay } from "../gateway/relay"
import { createRelayTransport } from "../remote/lazy-ops"
import type { GatewayStore } from "../gateway/store"
import type { Provenance } from "../gateway/types"
import { resolveProvenance } from "../gateway/provenance-resolver"
import { addressBook, sendAddressBook } from "./internals"
import type { ThreadHostView, ThreadToolSurfaceOptions } from "./ports"
import { sendView } from "./send-view"
import { stampThisDevice } from "../remote/this-device"

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
  /** The one send path: the engine behind the local transport, the device service behind the relay transport. */
  readonly pipeline: DeliveryPipeline
  readonly relay: GatewayRelay
  /** The calling session's workspace and project, as the engine stamps a delivery with them; a send to another device carries the same. */
  readonly senderProvenance: () => Promise<Provenance>
  /** The endpoint serving a session right now, or null when nothing answers for it. */
  readonly locate: (durableId: string) => Promise<GatewayEndpointRef | null>
}

/** The store-free live-and-disk resolver for extension calls, which run inside the store worker's transaction. */
export function createGatewayResolver(
  options: Omit<ThreadToolSurfaceOptions, "store">,
  view: () => Promise<ThreadHostView>,
): GatewayResolve {
  return async (address, request) => {
    const current = await view()
    return await resolveFromEntries(
      () => toGatewayAddressEntries(sendAddressBook(options, current, address, request.all_scope)),
      options.callerWorkspaceRoot,
    )(address, request)
  }
}

/**
 * The one composition of the gateway over a thread surface: the caller's store, the engine resolving addresses through the address book of `view`, and
 * the relay. The agent tools and the `omo thread` SDK both build on it, so neither duplicates the
 * engine; they differ only in the principal they pass. `view` is the send path's view (callers pass
 * one that answers even when nothing is live): a target no endpoint lists resolves from disk
 * (`sendAddressBook`) and is queued offline.
 */
export function createGatewayServices(
  options: ThreadToolSurfaceOptions,
  view: () => Promise<ThreadHostView>,
): GatewayServices {
  // The SDK and tools send through a fresh `list_sessions` on only the target's socket (#9222's
  // single-lookup rule); the extension path shares the plain live-and-disk resolver (no store).
  const resolve: GatewayResolve = async (address, request) => {
    const current = await sendView(options, address, view)
    return await resolveFromEntries(
      () => toGatewayAddressEntries(sendAddressBook(options, current, address, request.all_scope)),
      options.callerWorkspaceRoot,
    )(address, request)
  }
  const store = options.store
  const now = options.now ?? store.now
  const endpoints = options.host.gateway ?? UNREACHABLE
  const entries = async () => toGatewayAddressEntries(addressBook(options, await view()))
  // Both transports read this one provenance, so a local and a relayed delivery name the same sender device (#13004).
  const senderProvenance = (): Promise<Provenance> =>
    stampThisDevice(
      resolveProvenance({
        cwd: options.callerWorkspaceRoot(),
        env: options.env,
        ...(options.loadProvenanceWorkspaces === undefined ? {} : { loadWorkspaces: options.loadProvenanceWorkspaces }),
        ...(options.onProvenanceWarning === undefined ? {} : { onWarning: options.onProvenanceWarning }),
      }),
      options.remote,
    )
  const engine = createGatewayEngine({ store, endpoints, resolve, now, senderProvenance })
  const locate = async (durableId: string): Promise<GatewayEndpointRef | null> => {
    const entry = (await entries()).find((candidate) => candidate.thread_id === durableId)
    return entry === undefined || entry.liveness !== "routable" ? null : entry.endpoint
  }
  const relay = createGatewayRelay({ store, engine, endpoints, locate, now })
  const pipeline = createDeliveryPipeline({
    local: createLocalTransport(engine),
    ...(options.remote === undefined
      ? {}
      : {
          relay: createRelayTransport({
            remote: options.remote,
            store,
            now,
            senderProvenance,
            ...(options.callerCause === undefined ? {} : { callerCause: options.callerCause }),
            ...(options.callerChainHop === undefined ? {} : { callerChainHop: options.callerChainHop }),
          }),
        }),
  })
  return { store, endpoints, engine, pipeline, relay, senderProvenance, locate }
}
