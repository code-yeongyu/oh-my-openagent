import type { EffectiveModel } from "../pinned-model-equivalence"
import type { HostRpcClientFactory, HostProtocolProbe } from "./session-transport"

export interface OpenedHostSession {
  /** Routing handle of this session on this connection - ephemeral, never a durable identity. */
  readonly sessionId: string
  /** The host answered `attached`: this open re-joined a session that was still live. */
  readonly attached: boolean
  readonly instanceId: string
  readonly engineVersion: string
  /** The open asked for a session fallback chain the host cannot hold (no `retry_fallback_profile`). */
  readonly retryFallbackDropped?: boolean
  /** The model the host reported for a FRESH open (the post-start check's read; #9722). */
  readonly reportedModel?: EffectiveModel
}

/** The turn-delivery seam: the commands a child handle issues on its session. */
export type HostSessionCommand =
  | { readonly type: "prompt"; readonly message: string; readonly streamingBehavior?: "steer" | "followUp" }
  | { readonly type: "steer"; readonly message: string }
  | { readonly type: "followUp"; readonly message: string }
  | { readonly type: "abort" }

/** Why a child parked itself instead of reattaching. */
export type HostParkReason = "host_incompatible" | "own_host_unreachable" | "store_index_unavailable"

/**
 * Why the HOST parked a session it holds: its idle sweep (`idle_evicted`) or a generation handoff that
 * put the session back on disk (`handoff_parked`). A `session_parked` frame maps through
 * `SESSION_PARKED_CAUSE`.
 */
export type HostParkCause = "handoff_parked" | "idle_evicted"

export interface HostSessionParked {
  readonly sessionId: string
  readonly sessionPath: string
  readonly reason: HostParkReason | HostParkCause
}

export interface HostSessionClosed {
  readonly sessionId: string
  readonly reason: string | undefined
}

export interface HostSessionClientPorts {
  readonly createClient?: HostRpcClientFactory
  readonly probeProtocolInfo?: HostProtocolProbe
  readonly socketAccepts?: (socketPath: string) => Promise<boolean>
}

export interface HostSessionClientOptions {
  readonly socketPath: string
  readonly ports?: HostSessionClientPorts
}
