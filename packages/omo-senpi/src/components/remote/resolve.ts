import { normalizeThreadName } from "../thread/addressing"
import { type ClientCore, type RemoteClient } from "./client"
import { nextActionFor, remoteFailure } from "./codes"
import { canonicalizeThreadHandle, handleOf, type CanonicalThread } from "./seams"
import type { RemoteFailure, Scope, SessionRow } from "./types"

type Match = (
  { readonly kind: "one"; readonly row: SessionRow } | { readonly kind: "many"; readonly rows: readonly SessionRow[] }
) & {
  /** A name can gain a second holder or move to another session after any listing; an id or handle cannot. */
  readonly byName: boolean
}

// A name match is held to the caller's workspace unless all_scope; an id or `<device>/<session>` names one session
// account-wide, as on this device (thread/addressing.ts).
const inScope = (row: SessionRow, scope: Scope): boolean =>
  scope.all_scope === true || scope.workspace === undefined || row.project === scope.workspace

const deviceNamed = (row: SessionRow, device: string): boolean =>
  row.device.id === device || row.device.name.toLowerCase() === device.toLowerCase()

function match(rows: readonly SessionRow[], target: CanonicalThread): Match | undefined {
  const picked = (found: readonly SessionRow[], byName = false): Match | undefined => {
    const [only] = found
    if (only === undefined) return undefined
    return found.length === 1 ? { kind: "one", row: only, byName } : { kind: "many", rows: found, byName }
  }
  if (target.target.kind === "device_session") {
    const { device, session } = target.target
    return picked(
      rows.filter(
        (row) =>
          row.thread === target.handle ||
          (deviceNamed(row, device) && (row.durable_id === session || row.thread === handleOf(row.device.id, session))),
      ),
    )
  }
  const address = target.target.address
  const byId = picked(rows.filter((row) => row.durable_id === address || row.thread === address))
  if (byId !== undefined) return byId
  const wanted = normalizeThreadName(address)
  return picked(
    rows.filter((row) => inScope(row, target.scope) && normalizeThreadName(row.name) === wanted),
    true,
  )
}

const ambiguous = (address: string, rows: readonly SessionRow[]): RemoteFailure =>
  remoteFailure(
    "ambiguous_target",
    `${rows.length} sessions answer to ${address}.`,
    "Pass the thread handle of one of them.",
    {
      details: { candidates: rows.map((row) => ({ thread: row.thread, name: row.name, device: row.device.name })) },
    },
  )

/**
 * `sessions.resolve` (unit U5 of #13414): one address (durable id, name, `<device>/<session>`) to its row, served from
 * the last listing this client read, so a known id or handle costs no relist (contract L-1); a name always reads a fresh
 * listing, since another session may have taken it since. A miss reads the listing once:
 * filtered to the device when the address names one, else account-wide, and that read becomes the index. Aliases are
 * `aliases.resolve`'s; whether a session is still live is learned from the reply to the command sent to it.
 */
export function resolveMember(core: ClientCore): RemoteClient["sessions"]["resolve"] {
  let index: readonly SessionRow[] = []
  const remember = (rows: readonly SessionRow[], device: string | undefined) => {
    index = device === undefined ? rows : [...index.filter((row) => !deviceNamed(row, device)), ...rows]
  }
  return async (address, scope = {}, opts) => {
    const canonical = canonicalizeThreadHandle(address, scope)
    if (canonical.kind === "error") return canonical
    const target = canonical.value
    const cached = match(index, target)
    if (cached?.kind === "one" && !cached.byName) return { kind: "ok", value: cached.row }
    const device = target.target.kind === "device_session" ? target.target.device : undefined
    const listed = await core.sessionsList(device === undefined ? {} : { device }, opts)
    if (listed.kind === "error") return listed
    remember(listed.value.rows, device)
    const found = match(listed.value.rows, target)
    if (found?.kind === "one") return { kind: "ok", value: found.row }
    if (found?.kind === "many") return ambiguous(address, found.rows)
    return remoteFailure("not_found", `No session of this account answers to ${address}.`, nextActionFor("not_found"), {
      details: {
        kind: "session",
        ...(listed.value.unanswered.length === 0 ? {} : { unanswered: listed.value.unanswered.map((row) => row.id) }),
      },
    })
  }
}
