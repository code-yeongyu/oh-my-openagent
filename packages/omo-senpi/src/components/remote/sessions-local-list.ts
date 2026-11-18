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

/**
 * This device's sessions as listing rows, read from its own operator endpoint (#13787): the service's listing does not
 * carry the asking device's sessions, and every member serves them locally by durable id, which is their handle. A
 * session its host is closing or has closed is `ended`; any other one the host holds is `running`, as the service's
 * listing marks a session an engine holds. Empty when no operator endpoint runs here; undefined when it did not answer.
 */
export async function localSessionRows(
  hostOn: (connect: ThreadSocketConnect) => Promise<ThreadHost>,
  self: DeviceRow,
): Promise<readonly SessionRow[] | undefined> {
  let sessions: readonly ThreadHostSession[]
  try {
    // The operator endpoint's own list (the one a local open lands on); the whole-device view would run the engine.
    sessions = await (await hostOn((path) => createConnection(path))).listSessions()
  } catch (error) {
    // No operator endpoint running here holds no session; any other failure leaves this device unanswered.
    return error instanceof Error && error.message.startsWith("host_unavailable:") ? [] : undefined
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
      archived: session.archived === true,
      ...(session.model === undefined ? {} : { model: `${session.model.provider}/${session.model.id}` }),
      updated_ms: updatedMs(session),
      source: "live",
    }
  })
}
