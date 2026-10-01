import type { AddressBookHost, DiskSession } from "../address-book"
import type { EndpointKind } from "../endpoint-registry"
import type { GatewayEndpointPort, GatewayWakeReply, ReleaseSessionReply, ReleaseSessionRequest } from "../gateway/adapter"
import type { GatewayStore } from "../gateway/store"
import type { ThreadTranscriptEntry } from "../reader"

export type ThreadHostSession = {
  readonly sessionId: string
  readonly durableSessionId?: string
  readonly sessionPath?: string
  readonly cwd: string
  readonly name?: string | null
  readonly status?: "opening" | "open" | "closing" | "closed"
  /** senpi session kind (`interactive` | `worker`). */
  readonly kind?: string
  readonly createdAt?: string
  readonly updatedAt?: string
  /** A terminal control endpoint reports its timestamps snake-cased. */
  readonly created_at?: string | null
  readonly updated_at?: string | null
  /** What serves the endpoint that listed the session. */
  readonly endpoint_kind?: EndpointKind
  /**
   * The endpoint that listed this session. Routing ids are per-host counters (`rpc-1` on every
   * host), so a session is only addressable as the pair (socket, sessionId); absent for a host
   * that reaches exactly one endpoint.
   */
  readonly socket?: string
}

/** The per-session half of the host surface, bound to the ONE endpoint that holds the session. */
export type ThreadSessionPort = Pick<
  ThreadHost,
  "getMessages" | "getState" | "prompt" | "interrupt" | "setSessionName" | "setModel" | "getAvailableModels" | "setThinkingLevel" | "getAvailableThinkingLevels" | "wake" | "releaseSession"
>

/**
 * One call's view of every endpoint: the live sessions (each tagged with its `socket`), one
 * address-book host per endpoint (a dead endpoint carries its `error`), and the durable sessions a
 * dead endpoint last held, read from their JSONL with `source_host` set to that endpoint.
 */
export type ThreadHostView = {
  readonly sessions: readonly ThreadHostSession[]
  readonly hosts: readonly AddressBookHost[]
  readonly disk: readonly DiskSession[]
}

export type ThreadHostViewRequest = {
  /**
   * Answer the view even when no endpoint answered, instead of raising that failure: for a send,
   * nothing live is the offline case (`queued_offline`), not an error.
   */
  readonly offline?: boolean
}

/** The already-running senpi multi-session host, expressed as its public command surface. */
export type ThreadHost = {
  readonly socket: string
  readonly listSessions: () => Promise<readonly ThreadHostSession[]>
  readonly openSession: (params: { readonly cwd?: string; readonly sessionPath?: string; readonly name?: string; readonly forkFrom?: string }) => Promise<ThreadHostSession>
  readonly getMessages: (sessionId: string) => Promise<readonly ThreadTranscriptEntry[]>
  readonly getState: (sessionId: string) => Promise<{ readonly isStreaming?: boolean; readonly activeTurnId?: string }>
  readonly prompt: (sessionId: string, message: string, options?: { readonly streamingBehavior?: "steer" | "followUp" }) => Promise<{ readonly turnId?: string }>
  readonly interrupt: (sessionId: string, turnId?: string) => Promise<{ readonly interrupted?: boolean; readonly turnId?: string }>
  readonly setSessionName: (sessionId: string, name: string) => Promise<void>
  readonly setModel: (sessionId: string, provider: string, modelId: string) => Promise<{ provider: string; id: string; name?: string }>
  readonly getAvailableModels: (sessionId: string) => Promise<readonly { provider: string; id: string; name?: string }[]>
  readonly setThinkingLevel: (sessionId: string, level: string, scope?: "session" | "turn") => Promise<void>
  readonly getAvailableThinkingLevels: (sessionId: string) => Promise<readonly string[]>
  /** Runs the session's registered inbox drain once (`wake`); every endpoint kind answers it. */
  readonly wake?: (sessionId: string, deliveryIds: readonly string[]) => Promise<GatewayWakeReply>
  /** Hands a quiet host session to another runtime (`release_session`); hosts only. */
  readonly releaseSession?: (sessionId: string, request: ReleaseSessionRequest) => Promise<ReleaseSessionReply>
  /** Every endpoint at once; absent on a single-endpoint host, whose `listSessions` is the view. */
  readonly listView?: (request?: ThreadHostViewRequest) => Promise<ThreadHostView>
  /** The per-session methods on the endpoint a listed session's `socket` names. */
  readonly endpoint?: (socket: string) => ThreadSessionPort
  /** The session gateway's sender port over the same endpoints (`wake`, `release_session`, `extension_ui_response`). */
  readonly gateway?: GatewayEndpointPort
}

export type ThreadToolSurfaceOptions = {
  readonly host: ThreadHost
  readonly callerSessionId: () => string
  readonly callerWorkspaceRoot: () => string
  readonly stateDirectory: string
  readonly diskSessions?: () => readonly DiskSession[]
  /**
   * Where the engine writes session files (`<agentDir>/sessions`). A send whose target no endpoint
   * lists is resolved from them (`findDiskSessions`), so a session is addressable by id or name
   * whether or not this process ever saw it alive.
   */
  readonly sessionsDirectory?: () => string
  readonly ensureHost?: () => Promise<void>
  /**
   * The gateway store: the tools' idempotency receipts, bindings and outbox. The component passes
   * the one store it shares with the session's control endpoint; without one, a store is opened
   * under `stateDirectory` (QA harnesses and tests).
   */
  readonly store?: GatewayStore
  /** The caller's current turn (the gateway's per-turn fan-out budget is keyed by it); absent outside a turn. */
  readonly callerTurnId?: () => string | undefined
  /**
   * The delivery that caused the caller's current run, when one did: a send continues that causal
   * root (hop, cycle and budget guards), and a send with none starts a new root.
   */
  readonly callerCause?: () => string | undefined
  /** The delivery whose admission started the caller's current run; a report without `binding_id` goes to its binding. */
  readonly callerRunOrigin?: () => string | undefined
  /** `thread_report {kind: "completion"}` armed a completion for this session; the component writes it at the next settle. */
  readonly onCompletionArmed?: (durableId: string) => void
  readonly now?: () => number
}


/** Placeholder the component supplies when the host passes no per-call caller identity. */
export const UNKNOWN_CALLER = "unknown-caller"
