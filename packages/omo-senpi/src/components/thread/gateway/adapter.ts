/**
 * The narrow seam between the gateway and senpi. Every senpi interaction the store, engine and
 * drain need goes through these two ports, typed against the senpi `feat/tui-control-endpoint`
 * branch contracts (session-control-types.ts, rpc.md `wake` / `release_session`,
 * host-endpoint-liveness.ts). Those shapes are provisional until the senpi release that ships them
 * is adopted; the real implementations are wired then, and nothing else here changes.
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

export type GatewayWakeReply = {
  readonly admitted: readonly { readonly delivery_id: string; readonly kind: string }[]
}

export type ReleaseSessionReply =
  | {
      readonly released: true
      readonly session_path: string
      readonly attachments: number
      readonly dropped: { readonly deliveries: readonly string[]; readonly user_messages: readonly string[] }
    }
  | {
      readonly released: false
      readonly error: string
      readonly busy?: readonly string[]
      readonly dropped?: { readonly deliveries: readonly string[]; readonly user_messages: readonly string[] }
    }

/** Sender side: reaching another session's endpoint. */
export type GatewayEndpointPort = {
  readonly wake: (endpoint: GatewayEndpointRef, deliveryIds: readonly string[]) => Promise<GatewayWakeReply>
  readonly releaseSession?: (
    endpoint: GatewayEndpointRef,
    options: { readonly interrupt?: boolean; readonly force?: boolean },
  ) => Promise<ReleaseSessionReply>
  readonly classifyLiveness?: (endpoint: GatewayEndpointRef) => Promise<EndpointLiveness>
}

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

export type WakeReason = "idle" | "submission" | "draft_cleared" | "command" | "inbox" | "emitted" | "continue" | "start"

export type DrainWakeEvent = {
  readonly reason: WakeReason
  readonly delivery_ids?: readonly string[]
}
