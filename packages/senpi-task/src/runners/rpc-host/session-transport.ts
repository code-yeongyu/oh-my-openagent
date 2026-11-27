import type {
  NewSessionOptions,
  RpcClient,
  RpcExtensionUIResponse,
  RpcSessionState,
  RpcTransportGoneError,
} from "@code-yeongyu/senpi"

import { loadSenpiBarrel, senpiProbeHost, senpiRpcClient, type SenpiHostProtocolInfo } from "../../lazy/senpi-barrel"
import type { SenpiThinkingLevel } from "../../senpi/thinking-level"
import { designatedChainOf } from "../designated-fallback-profile"
import { personaPolicy, type PersonaPolicy } from "../rpc/persona-args"
import type { RpcEntriesResult, RpcPersona, RpcSwitchSessionResult } from "../types"
import { HostUnavailableError, TASK_DAEMON_PROTOCOL_VERSION, TASK_DAEMON_REQUIRED_CAPABILITIES } from "./daemon"
import type { HostRunHoldClient } from "./task-parent-wire"

/**
 * How a child session reaches the daemon: the engine-client port omo depends on, the senpi adapter
 * behind it, the `open_session` payload, and whether the daemon that answered may host this child.
 */

/** How the host settled a prompt: started a turn, delivered it to the running turn, or queued it. */
export type HostPromptDisposition = Awaited<ReturnType<RpcClient["prompt"]>>
/** How the host settled a steer/follow-up: delivered to the running turn, or queued behind it. */
export type HostQueuedInputDisposition = Awaited<ReturnType<RpcClient["steer"]>>
/** What the host holds for each input id (`get_pending_inputs`, senpi#3549). */
export type HostPendingInputs = Awaited<ReturnType<RpcClient["getPendingInputs"]>>

/** omo's structural view of the engine's `RpcClient`; the pinned engine may predate its fields. */
export interface HostRpcClient extends HostRunHoldClient {
  start(): Promise<void>
  stop(): Promise<void>
  onEvent(listener: (record: unknown) => void): () => void
  openSession(options: HostOpenSessionWire): Promise<{ sessionId: string; attached?: boolean }>
  closeSession(sessionId?: string): Promise<void>
  listSessions?(options: { include_workers: boolean }): Promise<readonly { sessionId: string }[]>
  sendExtensionUIResponse(response: RpcExtensionUIResponse): Promise<void>
  prompt(
    message: string,
    options?: { streamingBehavior?: "steer" | "followUp"; clientMessageId?: string },
  ): Promise<HostPromptDisposition>
  steer(
    message: string,
    images?: undefined,
    recovery?: { clientMessageId?: string },
  ): Promise<HostQueuedInputDisposition>
  followUp(
    message: string,
    images?: undefined,
    recovery?: { clientMessageId?: string },
  ): Promise<HostQueuedInputDisposition>
  /** Absent on an engine before senpi#3549. */
  getPendingInputs?(knownClientMessageIds?: readonly string[]): Promise<HostPendingInputs>
  abort(): Promise<void>
  getState(): Promise<RpcSessionState>
  getAvailableModels(): ReturnType<RpcClient["getAvailableModels"]>
  getEntries(since?: string): Promise<RpcEntriesResult>
  switchSession(sessionPath: string): Promise<RpcSwitchSessionResult>
  setSessionContext(
    patch: Readonly<Record<string, string | number | boolean | null>>,
    sessionId?: string,
  ): Promise<void>
}

/** A session's own fallback policy, held in memory by the host (senpi `retry_fallback_profile`). */
export interface HostRetryFallbackProfile {
  readonly modelFallback: boolean
  readonly fallbackChains: Readonly<Record<string, readonly string[]>>
}

/** The wire shape of `open_session`, in the engine's names. */
export interface HostOpenSessionWire {
  readonly spawnedBy?: NewSessionOptions["spawnedBy"]
  readonly sessionPath: string
  readonly cwd: string
  readonly provider?: string
  readonly modelId?: string
  readonly thinkingLevel?: SenpiThinkingLevel
  readonly kind: HostSessionOpenInput["kind"]
  readonly context: Readonly<Record<string, string>>
  readonly retain_on_disconnect: boolean
  readonly auto_title: boolean
  readonly retryFallback?: HostRetryFallbackProfile
  readonly permissionPreset?: string
  readonly persona?: PersonaPolicy
}

/**
 * HOST capability: the host applies `open_session.persona` (`appendSystemPrompt`, `tools`, `excludeTools`) to
 * that one session, as `--append-system-prompt` / `--tools` / `--exclude-tools` apply to a process (#13057).
 */
export const SESSION_PERSONA_CAPABILITY = "session_persona"

/** The immutable launch profile of one child session, in omo's names. */
export interface HostSessionOpenInput {
  readonly spawnedBy?: NewSessionOptions["spawnedBy"]
  readonly sessionPath: string
  readonly cwd: string
  readonly provider?: string
  readonly modelId?: string
  readonly thinkingLevel?: SenpiThinkingLevel
  readonly kind: "worker" | "interactive"
  readonly context: Readonly<Record<string, string>>
  readonly retainOnDisconnect: boolean
  readonly autoTitle: boolean
  /** Every host that opens a child advertises `retry_fallback_profile` (a required capability). */
  readonly retryFallback?: HostRetryFallbackProfile
  /** The parent's approval mode a child in the task host opens with (#6189 F2c); the host cannot see the parent. */
  readonly permissionPreset?: string
  /** The agent's instructions and tool policy; only a host advertising `session_persona` may open it. */
  readonly persona?: PersonaPolicy
}

/** A child's persona as the open request carries it; a child with none opens exactly as before. */
export function hostPersona(spec: RpcPersona): { readonly persona?: PersonaPolicy } {
  const persona = personaPolicy(spec, "host")
  return Object.keys(persona).length === 0 ? {} : { persona }
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
    ...(input.spawnedBy === undefined ? {} : { spawnedBy: input.spawnedBy }),
    ...(input.provider === undefined ? {} : { provider: input.provider }),
    ...(input.modelId === undefined ? {} : { modelId: input.modelId }),
    ...(input.thinkingLevel === undefined ? {} : { thinkingLevel: input.thinkingLevel }),
    kind: input.kind,
    context: input.context,
    retain_on_disconnect: input.retainOnDisconnect,
    auto_title: input.autoTitle,
    ...(input.retryFallback === undefined ? {} : { retryFallback: input.retryFallback }),
    ...(input.permissionPreset === undefined ? {} : { permissionPreset: input.permissionPreset }),
    ...(input.persona === undefined ? {} : { persona: input.persona }),
  }
}

/**
 * The daemon answering THIS child's probe must speak omo's protocol generation and carry the
 * session capabilities the child depends on. A narrower daemon is a LOUD per-child fallback to the
 * child-process runner (`capability`); anything else fails closed - a refused client never starts a
 * second host beside the daemon (invariant I1).
 */
export function assertHostUsable(
  info: SenpiHostProtocolInfo | undefined,
  retryFallback?: HostRetryFallbackProfile,
  persona?: PersonaPolicy,
): SenpiHostProtocolInfo {
  if (info === undefined) {
    throw new HostUnavailableError("host_unreachable", {
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
    const chain =
      retryFallback === undefined || !missing.includes("retry_fallback_profile")
        ? ""
        : `; the child's designated models (${designatedChainOf(retryFallback)}) cannot be held to on this host`
    throw new HostUnavailableError("capability", {
      fallbackAllowed: true,
      detail: `missing ${missing.join(", ")}${chain}`,
    })
  }
  // Only a child that carries a persona needs the host to hold it. On a host that cannot, the child runs as
  // its own process, where the same persona applies as flags: it never opens here without it.
  if (persona !== undefined && !info.capabilities.includes(SESSION_PERSONA_CAPABILITY)) {
    throw new HostUnavailableError("capability", {
      fallbackAllowed: true,
      personaUnsupported: true,
      detail: `missing ${SESSION_PERSONA_CAPABILITY}: this host cannot hold the child's instructions and tool policy, so the child never opens here; a child recorded on this host waits until it is upgraded`,
    })
  }
  return info
}
