import type { RpcExtensionUIResponse, RpcSessionState, RpcTransportGoneError } from "@code-yeongyu/senpi"

import { loadSenpiBarrel, senpiProbeHost, senpiRpcClient, type SenpiHostProtocolInfo } from "../../lazy/senpi-barrel"
import type { SenpiThinkingLevel } from "../../senpi/thinking-level"
import type { RpcEntriesResult, RpcSwitchSessionResult } from "../types"
import { HostUnavailableError, TASK_DAEMON_PROTOCOL_VERSION, TASK_DAEMON_REQUIRED_CAPABILITIES } from "./daemon"

/**
 * How a child session reaches the daemon: the engine-client port omo depends on, the senpi adapter
 * behind it, the `open_session` payload, and whether the daemon that answered may host this child.
 */

/** omo's structural view of the engine's `RpcClient`; the pinned engine may predate its fields. */
export interface HostRpcClient {
  start(): Promise<void>
  stop(): Promise<void>
  onEvent(listener: (record: unknown) => void): () => void
  openSession(options: HostOpenSessionWire): Promise<{ sessionId: string; attached?: boolean }>
  closeSession(sessionId?: string): Promise<void>
  sendExtensionUIResponse(response: RpcExtensionUIResponse): Promise<void>
  prompt(message: string, options?: { streamingBehavior?: "steer" | "followUp" }): Promise<void>
  steer(message: string): Promise<void>
  followUp(message: string): Promise<void>
  abort(): Promise<void>
  getState(): Promise<RpcSessionState>
  getEntries(since?: string): Promise<RpcEntriesResult>
  switchSession(sessionPath: string): Promise<RpcSwitchSessionResult>
}

/** The wire shape of `open_session`, in the engine's names. */
export interface HostOpenSessionWire {
  readonly sessionPath: string
  readonly cwd: string
  readonly provider?: string
  readonly modelId?: string
  readonly thinkingLevel?: SenpiThinkingLevel
  readonly kind: string
  readonly context: Readonly<Record<string, string>>
  readonly retain_on_disconnect: boolean
  readonly auto_title: boolean
}

/** The immutable launch profile of one child session, in omo's names. */
export interface HostSessionOpenInput {
  readonly sessionPath: string
  readonly cwd: string
  readonly provider?: string
  readonly modelId?: string
  readonly thinkingLevel?: SenpiThinkingLevel
  readonly kind: "worker" | "interactive"
  readonly context: Readonly<Record<string, string>>
  readonly retainOnDisconnect: boolean
  readonly autoTitle: boolean
}

export interface HostRpcClientOptions {
  readonly socketPath: string
  readonly onDisconnect: (error: RpcTransportGoneError) => void
}

export type HostRpcClientFactory = (options: HostRpcClientOptions) => Promise<HostRpcClient>
export type HostProtocolProbe = (socketPath: string) => Promise<SenpiHostProtocolInfo | undefined>

/** ONE engine client per child - a connection is never shared between two children. */
export async function createSenpiRpcClient(options: HostRpcClientOptions): Promise<HostRpcClient> {
  await loadSenpiBarrel()
  const RpcClient = senpiRpcClient()
  return new RpcClient({ socketPath: options.socketPath, onDisconnect: options.onDisconnect })
}

export async function probeWithEngine(socketPath: string): Promise<SenpiHostProtocolInfo | undefined> {
  await loadSenpiBarrel()
  return senpiProbeHost()({ socket: socketPath })
}

export function toWireOpen(input: HostSessionOpenInput): HostOpenSessionWire {
  return {
    sessionPath: input.sessionPath,
    cwd: input.cwd,
    ...(input.provider === undefined ? {} : { provider: input.provider }),
    ...(input.modelId === undefined ? {} : { modelId: input.modelId }),
    ...(input.thinkingLevel === undefined ? {} : { thinkingLevel: input.thinkingLevel }),
    kind: input.kind,
    context: input.context,
    retain_on_disconnect: input.retainOnDisconnect,
    auto_title: input.autoTitle,
  }
}

/**
 * The daemon answering THIS child's probe must speak omo's protocol generation and carry the
 * session capabilities the child depends on. A narrower daemon is a LOUD per-child fallback to the
 * child-process runner (`capability`); anything else fails closed - a refused client never starts a
 * second host beside the daemon (invariant I1).
 */
export function assertHostUsable(info: SenpiHostProtocolInfo | undefined): SenpiHostProtocolInfo {
  if (info === undefined) {
    throw new HostUnavailableError("protocol", {
      fallbackAllowed: false,
      detail: "the daemon did not answer get_protocol_info",
    })
  }
  if (info.protocolVersion !== TASK_DAEMON_PROTOCOL_VERSION) {
    throw new HostUnavailableError("protocol", {
      fallbackAllowed: false,
      detail: `daemon speaks protocol ${info.protocolVersion}`,
    })
  }
  const missing = TASK_DAEMON_REQUIRED_CAPABILITIES.filter((capability) => !info.capabilities.includes(capability))
  if (missing.length > 0) {
    throw new HostUnavailableError("capability", { fallbackAllowed: true, detail: `missing ${missing.join(", ")}` })
  }
  return info
}
