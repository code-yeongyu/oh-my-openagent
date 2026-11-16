import { createConnection } from "node:net"
import type { ThreadSocketConnect } from "../thread/live-surface"
import type { AddressBookHost } from "../thread/address-book"
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

// An endpoint that runs nothing: no socket at all, or a socket left behind that refuses the connect (`dead`).
const notRunning = (host: AddressBookHost): boolean =>
  host.reason === "dead" || String(host.error).startsWith("host_unavailable:")

// The same two answers as the failure a one-endpoint host raises.
const notListening = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false
  const code = Reflect.get(error, "code")
  return error.message.startsWith("host_unavailable:") || code === "ENOENT" || code === "ECONNREFUSED"
}

/**
 * This device's sessions as listing rows, read from its own endpoints (#13787): the operator endpoint and every endpoint
 * registered on disk. The service's listing does not carry the asking device's sessions, and every member serves them
 * locally by durable id, which is their handle. A session its host is closing or has closed is `ended`; any other one
 * the host holds is `running`, as the service's listing marks a session an engine holds. Empty when no endpoint runs here
 * (every one has no socket or refuses the connect); undefined when every endpoint failed and one of them failed any
 * other way, or the listing itself failed.
 */
export async function localSessionRows(
  hostOn: (connect: ThreadSocketConnect) => Promise<ThreadHost>,
  self: DeviceRow,
): Promise<readonly SessionRow[] | undefined> {
  let sessions: readonly ThreadHostSession[]
  try {
    const host = await hostOn((path) => createConnection(path))
    if (host.listView === undefined)
      // A host with one endpoint raises its failure: no socket there, or one nobody listens on, holds no session.
      sessions = await host.listSessions().catch((error: unknown) => {
        if (notListening(error)) return []
        throw error
      })
    else {
      // Every endpoint's own outcome: the listing alone raises only the first endpoint's failure.
      const view = await host.listView({ offline: true })
      if (view.hosts.length > 0 && view.hosts.every((endpoint) => endpoint.alive === false))
        return view.hosts.every(notRunning) ? [] : undefined
      sessions = view.sessions
    }
  } catch {
    return undefined
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
