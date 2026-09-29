/**
 * The narrow seam between the gateway and senpi. Every senpi interaction the store, engine and
 * drain need goes through these two ports, typed against the senpi `feat/tui-control-endpoint`
 * branch contracts (session-control-types.ts, rpc.md `wake` / `release_session`,
 * host-endpoint-liveness.ts, rpc-types.ts). Those shapes are PROVISIONAL until the senpi release
 * that ships them is adopted (both branches were still changing when this was aligned, 2026-09-29);
 * the real implementations are wired then, and nothing else here changes.
 */

export type GatewayEndpointKind = "rpc_host" | "tui"

export type EndpointLiveness = "routable" | "live_unresponsive" | "dead"

export type GatewayEndpointRef = {
  readonly kind: GatewayEndpointKind
  readonly socket: string
  readonly routing_id: string | null
}

export type ExternalAdmissionKind = "started" | "queued" | "steered" | "turn_conflict" | "held_draft" | "already_admitted"

export type GatewayAdmissionKind = ExternalAdmissionKind | "not_steerable" | "expired"

export type GatewayWakeReply = SessionControlDrainResult

export type ReleaseDropped = { readonly deliveries: readonly string[]; readonly user_messages: readonly string[] }

/** senpi `release_session { sessionId, reason: "takeover", interrupt?, force? }`; any other reason is refused. */
export type ReleaseSessionRequest = {
  readonly reason: "takeover"
  readonly interrupt?: boolean
  readonly force?: boolean
}

export type ReleaseRefusalCode =
  | "turn_active"
  | "session_busy"
  | "attached"
  | "invalid_release_reason"
  | "release_unsupported"
  | "host_draining"
  | "session_closing"
  | "unknown_session"

/**
 * A refusal is senpi's generic RPC failure: `success: false`, the code in `error`, and the details in
 * `errorData` (`dropped` is present when an `interrupt` already took queued work out before the
 * refusal, and those delivery ids must be requeued all the same).
 */
export type ReleaseSessionReply =
  | {
      readonly success: true
      readonly data: { readonly released: true; readonly session_path: string; readonly attachments: number; readonly dropped: ReleaseDropped }
    }
  | {
      readonly success: false
      readonly error: ReleaseRefusalCode | (string & {})
      readonly errorData?: {
        readonly attachments?: number
        readonly busy?: readonly string[]
        readonly interrupted?: boolean
        readonly dropped?: ReleaseDropped
        readonly detail?: "worker_runtime" | "no_session_file"
        readonly hint?: string
        readonly retry_with?: { readonly interrupt: true }
      }
    }

/** Sender side: reaching another session's endpoint. */
export type GatewayEndpointPort = {
  readonly wake: (endpoint: GatewayEndpointRef, deliveryIds: readonly string[]) => Promise<GatewayWakeReply>
  readonly releaseSession?: (endpoint: GatewayEndpointRef, request: ReleaseSessionRequest) => Promise<ReleaseSessionReply>
  readonly classifyLiveness?: (endpoint: GatewayEndpointRef) => Promise<EndpointLiveness>
  /**
   * Answers the session's pending extension UI request on its own endpoint (senpi#2372: the frame
   * names the request in `uiRequestId` and keeps its own `id`, which the reply echoes). Resolves the
   * session's verdict; throws only when no verdict came back. `thread_answer` calls it only after
   * the reply token matched.
   */
  readonly respondUi?: (endpoint: GatewayEndpointRef, answer: UiAnswer) => Promise<UiAnswerReply>
}

export type UiAnswer = { readonly ui_request_id: string; readonly text: string }
/** `error` is the endpoint's own refusal code (`unknown_request`, `question_already_resolved`, ...). */
export type UiAnswerReply = { readonly delivered: true } | { readonly delivered: false; readonly error: string }

export type RuntimePhase = "idle" | "mid_turn" | "waiting_question" | "compacting"

export type SessionAdmissionGate = {
  readonly can_admit: boolean
  readonly hold_reason?: "draft" | "ime" | "attachment"
  readonly editor_revision: number
  readonly turn_epoch: number
}

export type AdmitExternalMessageInput = {
  readonly delivery_id: string
  readonly text: string
  readonly deliverAs: "steer" | "followUp"
  readonly expected_turn_id?: number
}

/**
 * Receiver side: the target session's own runtime, called from its drain. All four calls are
 * synchronous and microsecond-scale in senpi (`pi.session.*`); `admitExternalMessage` may throw
 * once a `release_session` closed admission, which the drain treats as "not admitted here".
 */
export type SessionRuntimePort = {
  readonly phase: () => RuntimePhase
  readonly admissionGate: () => SessionAdmissionGate
  readonly admitExternalMessage: (input: AdmitExternalMessageInput) => { readonly kind: ExternalAdmissionKind; readonly turn_epoch: number }
  readonly listAdmittedDeliveries: () => { readonly pending: readonly string[]; readonly emitted: readonly string[] }
}

/** senpi's `SessionControlWakeReason` plus the drain-internal `start` (first pass after registration). */
export type WakeReason = "idle" | "submission" | "draft_cleared" | "command" | "inbox" | "emitted" | "continue" | "start"

export type DrainWakeEvent = {
  readonly reason: WakeReason
  readonly delivery_ids?: readonly string[]
}

export type SessionControlDrainResult = {
  readonly admitted?: readonly { readonly delivery_id: string; readonly kind: ExternalAdmissionKind }[]
}

export type RegisterControlEndpointOptions = {
  readonly inboxDir: string
  readonly drain: (event: { readonly type: "session_control_wake"; readonly reason: Exclude<WakeReason, "start">; readonly reasons: readonly Exclude<WakeReason, "start">[]; readonly delivery_ids?: readonly string[] }) => SessionControlDrainResult | undefined | Promise<SessionControlDrainResult | undefined>
  readonly isSessionReferenced?: () => boolean | Promise<boolean>
}

/** `pi.session.registerControlEndpoint` resolves this union; only `registered` exposes the session. */
export type SessionControlRegistration =
  | { readonly status: "registered"; readonly socket: string; readonly dispose: () => Promise<void> }
  | { readonly status: "unsupported"; readonly reason: "unsupported_platform" | "unsupported_mode" }
  | { readonly status: "failed"; readonly reason: string }

export type SessionControlRegistrar = (options: RegisterControlEndpointOptions) => Promise<SessionControlRegistration>

/**
 * The drain reports two omo-only outcomes senpi's `ExternalAdmissionKind` has no member for:
 * `not_steerable` and `expired` are REFUSALS decided by the gateway before the runtime was asked,
 * so nothing was admitted. They are left out of senpi's `admitted` list (which names what this
 * runtime took); the refusal is on the row, where the sender reads its outcome.
 */
export function toSessionControlDrainResult(result: { readonly admitted: readonly { readonly delivery_id: string; readonly kind: GatewayAdmissionKind }[] }): SessionControlDrainResult {
  const admitted: { delivery_id: string; kind: ExternalAdmissionKind }[] = []
  for (const entry of result.admitted) {
    if (entry.kind === "not_steerable" || entry.kind === "expired") continue
    admitted.push({ delivery_id: entry.delivery_id, kind: entry.kind })
  }
  return { admitted }
}
