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

// A failure that means nothing runs behind the endpoint: no socket file, or a socket a host left behind when it exited.
const NOT_RUNNING_CODES: ReadonlySet<string> = new Set(["ENOENT", "ECONNREFUSED"])
const runsNothing = (error: unknown): boolean =>
  error instanceof Error &&
  (error.message.startsWith("host_unavailable:") || NOT_RUNNING_CODES.has(String(Reflect.get(error, "code"))))
const endpointRunsNothing = (host: AddressBookHost): boolean =>
  host.reason === "dead" || String(host.error ?? "").startsWith("host_unavailable:")

/**
 * The sessions every endpoint here holds; `undefined` when some endpoint failed for a reason other than running nothing.
 * A multi-endpoint host is read whole (`offline`: every endpoint's own outcome, never only the first one's failure), so a
 * broken endpoint behind a missing or refused operator socket still leaves this device unanswered (#13960 L1).
 */
async function localListing(host: ThreadHost): Promise<readonly ThreadHostSession[] | undefined> {
  if (host.listView === undefined) {
    try {
      return await host.listSessions()
    } catch (error) {
      return runsNothing(error) ? [] : undefined
    }
  }
  const view = await host.listView({ offline: true })
  if (view.hosts.some((endpoint) => endpoint.alive !== false)) return view.sessions
  return view.hosts.every(endpointRunsNothing) ? [] : undefined
}

/**
 * This device's sessions as listing rows, read from its own endpoints (#13787): the service's listing does not carry the
 * asking device's sessions, and every member serves them locally by durable id, which is their handle. A session its host
 * is closing or has closed is `ended`; any other one the host holds is `running`, as the service's listing marks a session
 * an engine holds. Empty when nothing runs here; undefined when an endpoint that runs did not answer.
 */
export async function localSessionRows(
  hostOn: (connect: ThreadSocketConnect) => Promise<ThreadHost>,
  self: DeviceRow,
): Promise<readonly SessionRow[] | undefined> {
  let sessions: readonly ThreadHostSession[] | undefined
  try {
    sessions = await localListing(await hostOn((path) => createConnection(path)))
  } catch (error) {
    return runsNothing(error) ? [] : undefined
  }
  return sessions?.map((session) => {
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
