import { createConnection } from "node:net"
import type { ThreadSocketConnect } from "../thread/live-surface"
import type { ThreadHost, ThreadHostSession } from "../thread/tools/ports"
import { handleOf } from "./seams"
import type { DeviceRow, SessionRow } from "./types"

const text = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined)

const updatedMs = (session: ThreadHostSession): number => {
  const stamp =
    text(session.updatedAt) ?? text(session.updated_at) ?? text(session.createdAt) ?? text(session.created_at)
  const parsed = stamp === undefined ? Number.NaN : Date.parse(stamp)
  return Number.isNaN(parsed) ? 0 : parsed
}

const notRunning = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false
  const code = Reflect.get(error, "code")
  return error.message.startsWith("host_unavailable:") || code === "ENOENT" || code === "ECONNREFUSED"
}

/**
 * This device's sessions as listing rows, read from its own operator endpoint (#13787): the service's listing does not
 * carry the asking device's sessions, and every member serves them locally by durable id, which is their handle. A
 * session its host is closing or has closed is `ended`; any other one the host holds is `running`, as the service's
 * listing marks a session an engine holds. Empty when no endpoint runs here (none listening, or a socket left behind
 * that refuses the connect); undefined when one did not answer.
 */
export async function localSessionRows(
  hostOn: (connect: ThreadSocketConnect) => Promise<ThreadHost>,
  self: DeviceRow,
): Promise<readonly SessionRow[] | undefined> {
  let sessions: readonly ThreadHostSession[]
  try {
    sessions = await (await hostOn((path) => createConnection(path))).listSessions()
  } catch (error) {
    // No endpoint running here holds no session; any other failure leaves this device unanswered.
    return notRunning(error) ? [] : undefined
  }
  return sessions.map((session) => {
    const durable = session.durableSessionId ?? session.sessionId
    const name = text(session.name) ?? ""
    return {
      thread: handleOf(self.id, durable),
      durable_id: durable,
      name,
      title: name,
      device: self,
      project: session.cwd,
      path: session.sessionPath ?? "",
      state: session.status === "closing" || session.status === "closed" ? "ended" : "running",
      archived: false,
      updated_ms: updatedMs(session),
      source: "live",
    }
  })
}
