import {
  toSessionControlDrainResult,
  type AdmitExternalMessageInput,
  type DrainWakeEvent,
  type ExternalAdmissionKind,
  type RegisterControlEndpointOptions,
  type RuntimePhase,
  type SessionAdmissionGate,
  type SessionControlRegistrar,
  type SessionRuntimePort,
  type WakeReason,
} from "./adapter"
import { createInboxDrain, type InboxDrain, type InboxDrainOptions } from "./drain"
import { gatewayInboxDirectory } from "./paths"
import { createGatewayStore, type GatewayStore } from "./store"

/**
 * The provisional senpi `pi.session` control surface (`core/extensions/session-control-types.ts` on the
 * `feat/tui-control-endpoint` branch), typed structurally so omo depends on no unreleased senpi. A
 * host whose `pi` has no such surface registers nothing, and the session is simply not reachable
 * through the gateway.
 */
export type SenpiWakeEvent = Parameters<RegisterControlEndpointOptions["drain"]>[0]

export type SessionControlActionsPort = {
  readonly registerControlEndpoint: SessionControlRegistrar
  readonly admissionGate: () => SessionAdmissionGate
  readonly admitExternalMessage: (input: AdmitExternalMessageInput) => { readonly kind: ExternalAdmissionKind; readonly turn_epoch: number }
  readonly listAdmittedDeliveries: () => { readonly pending: readonly string[]; readonly emitted: readonly string[] }
  readonly persistHeaderNow: () => Promise<void>
}

const CONTROL_METHODS = ["registerControlEndpoint", "admissionGate", "admitExternalMessage", "listAdmittedDeliveries", "persistHeaderNow"] as const

/** `pi.session` when the host exposes the whole control surface; `undefined` on every engine that predates it. */
export function sessionControlOf(pi: unknown): SessionControlActionsPort | undefined {
  if (typeof pi !== "object" || pi === null) return undefined
  const session = (pi as { readonly session?: unknown }).session
  if (typeof session !== "object" || session === null) return undefined
  const surface = session as Record<string, unknown>
  if (!CONTROL_METHODS.every((method) => typeof surface[method] === "function")) return undefined
  return {
    registerControlEndpoint: (options) => (surface.registerControlEndpoint as SessionControlActionsPort["registerControlEndpoint"]).call(session, options),
    admissionGate: () => (surface.admissionGate as SessionControlActionsPort["admissionGate"]).call(session),
    admitExternalMessage: (input) => (surface.admitExternalMessage as SessionControlActionsPort["admitExternalMessage"]).call(session, input),
    listAdmittedDeliveries: () => (surface.listAdmittedDeliveries as SessionControlActionsPort["listAdmittedDeliveries"]).call(session),
    persistHeaderNow: () => (surface.persistHeaderNow as SessionControlActionsPort["persistHeaderNow"]).call(session),
  }
}

export type ControlSession = {
  readonly durableId: string
  readonly sessionPath: () => string | null
  readonly isIdle: () => boolean
  /** The session's own extension UI `notify`, where the queued notice appears. */
  readonly notify?: (text: string) => void
}

export function controlSessionOf(eventCtx: unknown): ControlSession | undefined {
  if (typeof eventCtx !== "object" || eventCtx === null) return undefined
  const context = eventCtx as { readonly sessionManager?: unknown; readonly isIdle?: unknown; readonly ui?: unknown }
  const manager = context.sessionManager as { readonly getSessionId?: unknown; readonly getSessionFile?: unknown } | undefined
  if (typeof manager?.getSessionId !== "function") return undefined
  const durableId: unknown = manager.getSessionId.call(manager)
  if (typeof durableId !== "string" || durableId.length === 0) return undefined
  const getFile = manager.getSessionFile
  const isIdle = context.isIdle
  const ui = context.ui as { readonly notify?: unknown } | undefined
  const notify = typeof ui?.notify === "function" ? (ui.notify as (message: string, type?: string) => void) : undefined
  return {
    ...(notify === undefined ? {} : { notify: (text: string) => notify.call(ui, text, "info") }),
    durableId,
    sessionPath: () => {
      if (typeof getFile !== "function") return null
      const file: unknown = getFile.call(manager)
      return typeof file === "string" && file.length > 0 ? file : null
    },
    isIdle: () => (typeof isIdle === "function" ? isIdle.call(eventCtx) !== false : true),
  }
}

export type RegistrationOutcome =
  | { readonly status: "registered"; readonly socket: string }
  | { readonly status: "already_registered" }
  | { readonly status: "unsupported"; readonly reason: string }
  | { readonly status: "failed"; readonly reason: string }

/** The senpi host generation a host session runs in (`pi.sessionContext.host_instance`); `undefined` in a terminal. */
export function hostInstanceOf(pi: unknown): string | undefined {
  if (typeof pi !== "object" || pi === null) return undefined
  const context = (pi as { readonly sessionContext?: unknown }).sessionContext
  if (typeof context !== "object" || context === null) return undefined
  const instance = (context as { readonly host_instance?: unknown }).host_instance
  return typeof instance === "string" && instance.length > 0 ? instance : undefined
}

export type ControlEndpointRegistrantOptions = {
  readonly control: SessionControlActionsPort
  readonly agentDir: () => string
  /** Stamped on this process's claims so a host `release_session` settles only its own runtime's rows. */
  readonly runtimeInstance?: string
  /** The component's store, shared with the thread tools; the registrant then neither opens nor disposes one. */
  readonly store?: GatewayStore
  /** Called for each delivery this session's runtime took (started, steered or queued): the cause of the run that follows. */
  readonly onAdmitted?: (durableId: string, deliveryId: string, kind: "started" | "steered" | "queued") => void
  /**
   * Awaited before the drain pass of a wake another process asked for (a `wake` command): the edge
   * on which the session learns of work written outside it, such as a completion armed from the CLI.
   * Ordinary edges (idle, submission, the inbox watcher) never call it.
   */
  readonly onCommandWake?: (durableId: string) => Promise<void>
  readonly log?: (line: string) => void
  /** Test seams: the store to use, and drain options (clock, crash hooks, a foreign identity). */
  readonly _test?: {
    readonly store?: GatewayStore
    readonly drain?: Pick<InboxDrainOptions, "now" | "_test">
  }
}

export type ControlEndpointRegistrant = {
  readonly start: (session: ControlSession) => Promise<RegistrationOutcome>
  readonly noteCompaction: (active: boolean) => void
  /** Disposes the registration first - senpi's clean exit asks `isSessionReferenced` then - and the store last. */
  readonly stop: () => Promise<void>
  readonly currentDrain: () => InboxDrain | undefined
}

const SENPI_REASONS: ReadonlySet<string> = new Set<WakeReason>(["idle", "submission", "draft_cleared", "command", "inbox", "emitted", "continue"])

function drainEvent(event: SenpiWakeEvent): DrainWakeEvent {
  const reason = SENPI_REASONS.has(event.reason) ? (event.reason as WakeReason) : "inbox"
  return event.delivery_ids === undefined ? { reason } : { reason, delivery_ids: event.delivery_ids }
}

type Active = {
  readonly durableId: string
  readonly drain: InboxDrain
  readonly retire: () => void
  readonly dispose: () => Promise<void>
}

/**
 * The receiver half's only entry point: registers a session's control endpoint with senpi, handing
 * it todo 11's inbox drain, so the drain runs on the session's own `session_control_wake` edges
 * (idle, the user's submission or cleared draft, a `wake` command, the inbox watcher, SIGCONT, and
 * the pass senpi requests right after registration). The header is persisted first, so the durable
 * id is on disk before the endpoint is visible. One registration at a time; every call is
 * serialized, so a shutdown that arrives while a registration is still arming waits for it.
 */
export function createControlEndpointRegistrant(options: ControlEndpointRegistrantOptions): ControlEndpointRegistrant {
  const log = options.log ?? (() => undefined)
  const shared = options.store ?? options._test?.store
  let store: GatewayStore | undefined = shared
  let active: Active | undefined
  let compacting = false
  let queue: Promise<unknown> = Promise.resolve()

  function serialized<T>(work: () => Promise<T>): Promise<T> {
    const next = queue.then(work)
    queue = next.catch(() => undefined)
    return next
  }

  async function release(): Promise<void> {
    const current = active
    active = undefined
    if (current === undefined) return
    try {
      await current.dispose()
    } finally {
      current.retire()
    }
  }

  async function register(session: ControlSession): Promise<RegistrationOutcome> {
    if (active?.durableId === session.durableId) return { status: "already_registered" }
    await release()
    const control = options.control
    try {
      await control.persistHeaderNow()
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      log(`thread gateway: the session header could not be persisted, so the session is not registered: ${reason}`)
      return { status: "failed", reason }
    }
    const agentDir = options.agentDir()
    store ??= createGatewayStore({ agentDir, ...(options.runtimeInstance === undefined ? {} : { runtimeInstance: options.runtimeInstance }) })
    const runtime: SessionRuntimePort = {
      phase: (): RuntimePhase => (compacting ? "compacting" : session.isIdle() ? "idle" : "mid_turn"),
      admissionGate: () => control.admissionGate(),
      admitExternalMessage: (input) => control.admitExternalMessage(input),
      listAdmittedDeliveries: () => control.listAdmittedDeliveries(),
    }
    const drain = createInboxDrain({
      store,
      runtime,
      durableId: session.durableId,
      sessionPath: session.sessionPath,
      log,
      onAdmitted: (deliveryId, kind) => options.onAdmitted?.(session.durableId, deliveryId, kind),
      ...(session.notify === undefined ? {} : { notify: session.notify }),
      ...options._test?.drain,
    })
    let retired = false
    const retire = () => {
      retired = true
      drain.stop()
    }
    const drainOnce = async (event: SenpiWakeEvent) => toSessionControlDrainResult(await drain.drain(drainEvent(event)))
    const reply = await control.registerControlEndpoint({
      inboxDir: gatewayInboxDirectory(agentDir, session.durableId),
      drain: async (event) => {
        if (retired) return { admitted: [] }
        if (event.reason === "command" || event.reasons.includes("command")) await options.onCommandWake?.(session.durableId)
        return await drainOnce(event)
      },
      isSessionReferenced: () => drain.isSessionReferenced(),
    })
    if (reply.status !== "registered") {
      retire()
      if (reply.status === "failed") log(`thread gateway: the control endpoint for ${session.durableId} failed to register: ${reply.reason}`)
      return reply
    }
    active = { durableId: session.durableId, drain, retire, dispose: reply.dispose }
    // A reply token names the runtime that held the session when it asked; registering is what
    // makes this runtime the holder, so a restart turns earlier tokens stale.
    try {
      await store.registerIncarnation({ durable_id: session.durableId, incarnation: (await store.identity()).instance_id })
    } catch (error) {
      log(`thread gateway: the session incarnation for ${session.durableId} was not recorded: ${error instanceof Error ? error.message : String(error)}`)
    }
    return { status: "registered", socket: reply.socket }
  }

  return {
    start: (session) => serialized(() => register(session)),
    noteCompaction: (value) => {
      compacting = value
    },
    stop: () =>
      serialized(async () => {
        try {
          await release()
        } finally {
          const owned = shared === undefined ? store : undefined
          store = shared
          await owned?.dispose()
        }
      }),
    currentDrain: () => active?.drain,
  }
}
