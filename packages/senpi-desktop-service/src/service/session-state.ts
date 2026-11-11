import type { RpcClient } from "./rpc-client"

/** Public `session.open` params; the service fills the default-on cursor preference. */
export interface DesktopSessionOpenParams {
  readonly display?: string | null
  readonly macosCanary?: "session" | "off"
  readonly showCursor?: boolean
  readonly allowHostRelayOnlyStop?: boolean
  readonly auditPath?: string | null
  readonly artifactDir?: string | null
  readonly screenshotGc?: { readonly staleMs?: number; readonly scanIntervalMs?: number }
  readonly captureCaps?: {
    readonly maxWidth?: number | null
    readonly maxHeight?: number | null
    readonly coordinateSafe?: boolean
    readonly maxBytes?: number
  }
  /**
   * `object` (the default) asks for an `ActionReport` per exec, `null` for today's `null` reply; sent whenever the
   * engine advertises `action-report`, so an engine without it keeps replying `null`.
   */
  readonly reportMode?: "null" | "object"
  /** Sent whenever the engine advertises `intervention-policy`; omitted means the engine default `pause`. */
  readonly intervention?: "continue" | "pause"
  /** Sent whenever the engine advertises `key-priming`; omitted means the engine default `off`. */
  readonly macosKeyPriming?: "on" | "off"
  /** Sent whenever the engine advertises `trace`; omitted means the engine default `false`. */
  readonly trace?: boolean
}

/** One live engine child and its process-local safety state. */
export interface Connection {
  readonly rpc: RpcClient
  resumeToken: string
  /** `engine.hello` features of this child; `[]` until the hello reply and from engines that predate the list. */
  features: readonly string[]
  armedChord: string | undefined
  heartbeat: NodeJS.Timeout | undefined
}

/** What the host asked for; replayed onto a fresh child after restart. */
export interface DesiredSession {
  readonly params: DesktopSessionOpenParams & { readonly showCursor: boolean }
  chord: string | undefined
}
