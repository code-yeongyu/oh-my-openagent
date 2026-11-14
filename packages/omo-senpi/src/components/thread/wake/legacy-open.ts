import { existsSync } from "node:fs"
import { createConnection } from "node:net"

import { resolveRpcSocketTransport } from "@oh-my-opencode/senpi-task/rpc-socket-client"
import { resolveAgentHome } from "../../agent-home/resolve-agent-home"
import { requestFrame, type RpcFrame } from "../live-surface"
import { resolveThreadSocket } from "../live-surface-paths"

export type WakeOpenRequest = { readonly sessionPath: string; readonly cwd: string }

export type WakeOpenReply =
  | { readonly kind: "opened"; readonly session_id: string; readonly state: unknown; readonly attached: boolean }
  | { readonly kind: "refused"; readonly code: string; readonly retry_after_ms?: number }
  | { readonly kind: "unreachable"; readonly message: string }

export type WakeOpen = (request: WakeOpenRequest) => Promise<WakeOpenReply>

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** The engine's refusal code: `errorCode` when present, else the code prefix legacy replies put in `error`. */
function refusalOf(frame: RpcFrame): WakeOpenReply {
  const code =
    typeof frame.errorCode === "string"
      ? frame.errorCode
      : typeof frame.error === "string"
        ? (frame.error.split(":")[0] ?? frame.error).trim()
        : "unknown"
  const hint = record(frame.errorData) ? frame.errorData.retry_after_ms : undefined
  return { kind: "refused", code, ...(typeof hint === "number" ? { retry_after_ms: hint } : {}) }
}

function classifyOpenFrame(frame: RpcFrame): WakeOpenReply {
  if (frame.success === true && record(frame.data) && typeof frame.data.sessionId === "string")
    return {
      kind: "opened",
      session_id: frame.data.sessionId,
      state: frame.data.state ?? null,
      attached: frame.data.attached === true,
    }
  return refusalOf(frame)
}

/**
 * The wake's open on this agent directory's legacy host socket (#13037 design 5.2 step 5): one plain frame
 * `open_session { sessionPath, cwd, retain_on_disconnect: true }`, through the same authenticated request the thread tools
 * use. It names no `attended` field, so the open adds no unattended hold, and no `permissionPreset`, so the session runs
 * under the host's own default (A3.3).
 */
export function createLegacyWakeOpen(options: {
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly keyRoot?: () => string
}): WakeOpen {
  const env = options.env ?? process.env
  const keyRoot = options.keyRoot ?? (() => env.SENPI_RPC_KEY_ROOT?.trim() || resolveAgentHome({ env }))
  return async ({ sessionPath, cwd }) => {
    const socket = resolveThreadSocket(env)
    const transport = await resolveRpcSocketTransport(socket)
    if (transport === undefined || (process.platform !== "win32" && !existsSync(socket)))
      return { kind: "unreachable", message: `no host answers ${socket}` }
    try {
      const frame = await requestFrame(
        socket,
        { type: "open_session", sessionPath, cwd, retain_on_disconnect: true },
        () => createConnection(transport.address),
        { secret: transport.secret, rpcHost: true, keyRoot },
      )
      return classifyOpenFrame(frame)
    } catch (error) {
      return { kind: "unreachable", message: error instanceof Error ? error.message : String(error) }
    }
  }
}
