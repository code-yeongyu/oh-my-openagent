import type { RemoteSessionRow, RemoteSessionsPort, RemoteThreadSurface } from "./ports"

const rowKey = (row: RemoteSessionRow): string => `${row.device}\u0000${row.durable_id ?? row.session_id}`

type Mark =
  | { readonly kind: "closed"; readonly updated_ms: number; readonly path: string }
  | { readonly kind: "reopened"; readonly updated_ms: number; readonly key: string }

// One ledger per sessions port: every tool surface built over the same port shares it, and the port keeps one identity
// for the caches keyed by it (transcript-tail.ts).
const wrapped = new WeakMap<RemoteSessionsPort, RemoteSessionsPort>()

/**
 * #14170: the account listing lags a close and a reopen (it can serve a session's last snapshot for minutes). A thread
 * this surface closed reads `ended` with the file its unload named, so it is neither answered as already live nor
 * reopened by an empty path; a thread it reopened reads live under the key its device located it by, so the next op
 * reaches the reopened session instead of the closed one's key. The listing counts again once it shows the change
 * itself, or activity newer than it.
 */
export function withClosedRows(remote: RemoteThreadSurface): RemoteThreadSurface {
  const known = wrapped.get(remote.sessions)
  if (known !== undefined) return { ...remote, sessions: known }
  const marks = new Map<string, Mark>()
  const settle = (row: RemoteSessionRow): RemoteSessionRow => {
    const key = rowKey(row)
    const mark = marks.get(key)
    if (mark === undefined) return row
    const caughtUp =
      row.updated_ms > mark.updated_ms || (mark.kind === "closed" ? row.state === "ended" : row.session_id === mark.key)
    if (caughtUp) {
      marks.delete(key)
      return row
    }
    return mark.kind === "closed"
      ? { ...row, state: "ended", path: row.path === "" ? mark.path : row.path }
      : { ...row, session_id: mark.key, state: row.state === "ended" ? "idle" : row.state, source: "live" }
  }
  const { listing } = remote.sessions
  const sessions: RemoteSessionsPort = {
    ...remote.sessions,
    sessions: async (filter) => (await remote.sessions.sessions(filter)).map(settle),
    ...(listing === undefined
      ? {}
      : {
          listing: async () => {
            const listed = await listing()
            return { ...listed, rows: listed.rows.map(settle) }
          },
        }),
    closed: (row, path) =>
      marks.set(rowKey(row), { kind: "closed", updated_ms: row.updated_ms, path: path ?? row.path }),
    reopened: (row, key) => marks.set(rowKey(row), { kind: "reopened", updated_ms: row.updated_ms, key }),
  }
  wrapped.set(remote.sessions, sessions)
  return { ...remote, sessions }
}
