import { log } from "@oh-my-opencode/utils"

import { socketAcceptsConnection } from "./busy-host"
import { askHost, isRecord, type HostReply } from "./host-request"
import { probeWithEngine } from "./session-transport"

/**
 * The two questions the lifecycle asks a daemon once per pass: "are you there?" (`get_protocol_info`
 * through the engine's own `probeHost`) and "which session paths do you still hold?"
 * (`list_sessions { include_workers: true }` - worker rows are hidden by default, and every task
 * child is a worker). An unreachable daemon holds nothing, which makes the lifecycle reopen from JSONL
 * rather than attach. A listing the daemon refuses or does not answer is an ERROR, never an empty list:
 * "could not ask" must stay distinguishable from "holds nothing" (omo#9450).
 */

const LIST_REQUEST_ID = "omo-task-liveness"
const LIST_TIMEOUT_MS = 10_000
// Bounded so a wedged accept can never hold a draining host open; the socket is destroyed on connect.
const BUSY_CONNECT_TIMEOUT_MS = 500

export async function daemonReachable(socket: string): Promise<boolean> {
  try {
    if ((await probeWithEngine(socket)) !== undefined) return true
  } catch (error) {
    log("senpi-task daemon probe failed", { socket, error: String(error) })
  }
  // A daemon whose loop is blocked still completes the connect from its listen backlog: it is busy,
  // not gone, and parking its children as daemon_unavailable strands live sessions (omo#9069).
  if (process.platform !== "win32" && (await socketAcceptsConnection(socket, BUSY_CONNECT_TIMEOUT_MS))) {
    log("senpi-task daemon probe unanswered but the socket accepts; treating the daemon as busy", { socket })
    return true
  }
  return false
}

/**
 * Asked on the wire, never through the engine's `RpcClient.listSessions()`: that client sends a bare
 * `list_sessions` and drops `include_workers`, so every task child would read as gone - and a live
 * child that reads as gone is claimed by the next omo session that reconciles the store (#8932).
 */
export async function liveSessionPaths(socket: string): Promise<readonly string[]> {
  const reply = await askDaemon(socket, { id: LIST_REQUEST_ID, type: "list_sessions", include_workers: true })
  if (reply === undefined) {
    log("senpi-task daemon session list failed", { socket })
    throw new Error(`list_sessions failed on ${socket}`)
  }
  const sessions = reply.sessions
  if (!Array.isArray(sessions)) throw new Error(`list_sessions on ${socket} answered without a session list`)
  return sessions.flatMap((row: unknown) => (isRecord(row) && typeof row.sessionPath === "string" ? [row.sessionPath] : []))
}

// A refusal answers undefined, exactly like no answer: both mean "holds nothing we can see".
async function askDaemon(socket: string, request: HostReply): Promise<HostReply | undefined> {
  const reply = await askHost(socket, request, LIST_TIMEOUT_MS)
  if (reply?.success !== true) return undefined
  return isRecord(reply.data) ? reply.data : {}
}
