import type { RemoteSessionRow, RemoteSessionsPort, RemoteThreadSurface } from "./ports"

const rowKey = (row: RemoteSessionRow): string => `${row.device}\u0000${row.durable_id ?? row.session_id}`

type Mark =
  | { readonly kind: "closed"; readonly updated_ms: number; readonly file?: string }
  | { readonly kind: "reopened"; readonly updated_ms: number; readonly key: string }

// One ledger per sessions port: every tool surface built over the same port shares it, and the port keeps one identity
// for the caches keyed by it (transcript-tail.ts).
const wrapped = new WeakMap<RemoteSessionsPort, RemoteSessionsPort>()

/**
 * #14170: the account listing lags a close and a reopen (it can serve a session's last snapshot for minutes), and it
 * never names a session's file. A thread this surface closed reads `ended` and carries the file its unload named
 * (`session_file`), so it is neither answered as already live nor reopened from a folder, until the listing shows newer
 * activity on it (someone reopened it). A thread this surface reopened reads live under the key its device located it
 * by, so the next op reaches the reopened session instead of the closed one's key, until the listing shows that key.
 */
export function withClosedRows(remote: RemoteThreadSurface): RemoteThreadSurface {
  const known = wrapped.get(remote.sessions)
  if (known !== undefined) return { ...remote, sessions: known }
  const marks = new Map<string, Mark>()
  const settle = (row: RemoteSessionRow): RemoteSessionRow => {
    const key = rowKey(row)
    const mark = marks.get(key)
    if (mark === undefined) return row
    if (row.updated_ms > mark.updated_ms || (mark.kind === "reopened" && row.session_id === mark.key)) {
      marks.delete(key)
      return row
    }
    return mark.kind === "closed"
      ? { ...row, state: "ended", ...(mark.file === undefined ? {} : { session_file: mark.file }) }
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
    closed: (row, file) => {
      const known = file ?? row.session_file
      marks.set(rowKey(row), {
        kind: "closed",
        updated_ms: row.updated_ms,
        ...(known === undefined ? {} : { file: known }),
      })
    },
    reopened: (row, key) => marks.set(rowKey(row), { kind: "reopened", updated_ms: row.updated_ms, key }),
  }
  wrapped.set(remote.sessions, sessions)
  return { ...remote, sessions }
}
