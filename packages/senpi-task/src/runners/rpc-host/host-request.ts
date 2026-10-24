import { resolveAgentHome } from "../../agent-home"
import { authenticateRpcHost, authRequiredError, resolveRpcSocketTransport, RpcIdentityError, withRpcSocket } from "./socket-client"

export type HostReply = Readonly<Record<string, unknown>>

/**
 * One short-lived connection, one command, the reply carrying its id - success or refusal. A daemon
 * broadcasts lifecycle records to every connection, so the first line is not necessarily the answer.
 * Undefined when the host could not be reached or did not answer within `timeoutMs`. The daemon
 * runner uses the logical socket path directly on POSIX and its authenticated named-pipe transport
 * on Windows.
 */
export async function askHost(socket: string, request: HostReply, timeoutMs: number, options: { readonly keyRoot?: string; readonly agentDir?: string } = {}): Promise<HostReply | undefined> {
  const transport = await resolveRpcSocketTransport(socket)
  if (transport === undefined) return undefined
  const agentDir = options.agentDir ?? resolveAgentHome({ env: process.env })
  const keyRoot = options.keyRoot ?? (process.env.SENPI_RPC_KEY_ROOT?.trim() || agentDir)
  try {
    return await withRpcSocket(transport.address, { timeoutMs, secret: transport.secret }, async (send) => {
      if (process.platform !== "win32") {
        const info = await authenticateRpcHost(send, socket, keyRoot, request.type === "get_protocol_info" ? request : undefined)
        if (request.type === "get_protocol_info") return info
      }
      const reply = await send(request)
      if (reply.success === false && (reply.errorCode ?? reply.error) === "auth_required") throw authRequiredError(socket)
      return reply
    })
  } catch (error) {
    if (error instanceof RpcIdentityError) throw error
    return undefined
  }
}

export function isRecord(value: unknown): value is HostReply {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
