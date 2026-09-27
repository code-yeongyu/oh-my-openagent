import type { RunnerOutcome } from "../in-process/child-handle"
import type {
  ChildEventListener,
  RpcChildHandle,
  RpcEntriesResult,
  RpcSwitchSessionResult,
  RpcTerminalAssistantMessage,
} from "../types"
import type { HostSessionReattach } from "./reattach"
import type { HostSessionClosed, HostSessionCommand, HostSessionParked } from "./session-client"

/**
 * What a child handle needs FROM a daemon session and what it exposes TO the manager. The seam is
 * an interface, not the client class, so a suite can drive the handle over an in-memory session.
 */

/** The heartbeat reads liveness and the durable session id off `get_state`; recovery reads whether a turn still runs. */
export interface HostSessionLiveness {
  readonly sessionId: string
  readonly isStreaming?: boolean
}

/** `HostSessionClient` satisfies this structurally. The transport error itself is never read. */
export interface HostSessionPort {
  readonly socketPath: string
  readonly transportGone: Promise<unknown>
  send(command: HostSessionCommand): Promise<void>
  getState(): Promise<HostSessionLiveness>
  onEvent(listener: ChildEventListener): () => void
  onParked(listener: (event: HostSessionParked) => void): () => void
  onClosed(listener: (event: HostSessionClosed) => void): () => void
  getEntries(since?: string): Promise<RpcEntriesResult>
  switchSession(sessionPath: string): Promise<RpcSwitchSessionResult>
  close(): Promise<void>
  detach(): Promise<void>
}

/**
 * The host's word on the open that produced the current port: `attached` re-joined a session the
 * host still had live (its turn, if any, is still running there); `reopened` loaded it from its JSONL.
 */
export type HostSessionOpenDisposition = "attached" | "reopened"

/** Where a child lives on the daemon. `instanceId` is informational - it rotates on a handoff. */
export interface HostSessionIdentity {
  readonly routingId: string
  readonly sessionPath: string
  readonly instanceId: string
}

/** The identity as a record stores it, socket included. */
export interface HostSessionFacts extends HostSessionIdentity {
  readonly socket: string
}

export type HostSessionHandleOptions = {
  readonly client: HostSessionPort
  readonly session: HostSessionIdentity
  readonly taskId: string
  readonly heartbeatIntervalMs: number
  readonly now: () => number
  readonly closeGraceMs: number
  readonly openDisposition: HostSessionOpenDisposition
  /** Transport recovery. Absent: a lost transport ends the child as crashed(transport_gone). */
  readonly reattach?: HostSessionReattach
}

export type HostSessionChildHandle = RpcChildHandle & {
  readonly kind: "host-session"
  /** False once the session was parked, closed, lost or deliberately left behind. */
  readonly attached: boolean
  /** How the host answered the open behind the current port - never connection liveness. */
  readonly openDisposition: HostSessionOpenDisposition
  readonly hostSession: HostSessionFacts
  /** Served by the CURRENT port, so they keep working after a reattach. */
  getEntries(since?: string): Promise<RpcEntriesResult>
  switchSession(sessionPath: string): Promise<RpcSwitchSessionResult>
  /** Drop this child's connection and leave the session running on the daemon. */
  detach(): Promise<void>
  /** End the session on the host without aborting a turn first (`clean`). */
  close(): Promise<void>
  /** The daemon suspended the session: no exit, no status change - the record parks. */
  onParked(listener: (event: HostSessionParked) => void): () => void
  startInitialPrompt(text: string): Promise<void>
  waitForOutcome(): Promise<RunnerOutcome>
  hasExited(): boolean
  terminalAssistantMessage(): RpcTerminalAssistantMessage | undefined
  wasAbortedByUser(): boolean
}
