import type {
  AdmitExternalMessageInput,
  DrainWakeEvent,
  ExternalAdmissionKind,
  RuntimePhase,
  SessionAdmissionGate,
  SessionRuntimePort,
  WakeReason,
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
export type SenpiWakeEvent = {
  readonly type?: string
  readonly reason: string
  readonly reasons?: readonly string[]
  readonly delivery_ids?: readonly string[]
}

export type SenpiDrainResult = { readonly admitted: readonly { readonly delivery_id: string; readonly kind: ExternalAdmissionKind }[] }

export type SenpiControlRegistration =
  | { readonly status: "registered"; readonly socket: string; readonly dispose: () => Promise<void> }
  | { readonly status: "unsupported"; readonly reason: string }
  | { readonly status: "failed"; readonly reason: string }

export type SessionControlActionsPort = {
  readonly registerControlEndpoint: (options: {
    readonly inboxDir: string
    readonly drain: (event: SenpiWakeEvent) => Promise<SenpiDrainResult>
    readonly isSessionReferenced: () => Promise<boolean>
  }) => Promise<SenpiControlRegistration>
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
}

export function controlSessionOf(eventCtx: unknown): ControlSession | undefined {
  if (typeof eventCtx !== "object" || eventCtx === null) return undefined
  const context = eventCtx as { readonly sessionManager?: unknown; readonly isIdle?: unknown }
  const manager = context.sessionManager as { readonly getSessionId?: unknown; readonly getSessionFile?: unknown } | undefined
  if (typeof manager?.getSessionId !== "function") return undefined
  const durableId: unknown = manager.getSessionId.call(manager)
  if (typeof durableId !== "string" || durableId.length === 0) return undefined
  const getFile = manager.getSessionFile
  const isIdle = context.isIdle
  return {
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

export type ControlEndpointRegistrantOptions = {
  readonly control: SessionControlActionsPort
  readonly agentDir: () => string
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
const EXTERNAL_KINDS: ReadonlySet<string> = new Set<ExternalAdmissionKind>(["started", "queued", "steered", "turn_conflict", "held_draft", "already_admitted"])

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
  let store: GatewayStore | undefined = options._test?.store
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
    store ??= createGatewayStore({ agentDir })
    const runtime: SessionRuntimePort = {
      phase: (): RuntimePhase => (compacting ? "compacting" : session.isIdle() ? "idle" : "mid_turn"),
      admissionGate: () => control.admissionGate(),
      admitExternalMessage: (input) => control.admitExternalMessage(input),
      listAdmittedDeliveries: () => control.listAdmittedDeliveries(),
    }
    const drain = createInboxDrain({ store, runtime, durableId: session.durableId, sessionPath: session.sessionPath, log, ...options._test?.drain })
    let retired = false
    const reply = await control.registerControlEndpoint({
      inboxDir: gatewayInboxDirectory(agentDir, session.durableId),
      drain: async (event) => {
        if (retired) return { admitted: [] }
        const result = await drain.drain(drainEvent(event))
        return { admitted: result.admitted.flatMap((entry) => (EXTERNAL_KINDS.has(entry.kind) ? [{ delivery_id: entry.delivery_id, kind: entry.kind as ExternalAdmissionKind }] : [])) }
      },
      isSessionReferenced: () => drain.isSessionReferenced(),
    })
    if (reply.status !== "registered") {
      retired = true
      if (reply.status === "failed") log(`thread gateway: the control endpoint for ${session.durableId} failed to register: ${reply.reason}`)
      return reply
    }
    active = { durableId: session.durableId, drain, retire: () => { retired = true }, dispose: reply.dispose }
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
          const owned = options._test?.store === undefined ? store : undefined
          store = options._test?.store
          await owned?.dispose()
        }
      }),
    currentDrain: () => active?.drain,
  }
}
