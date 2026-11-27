import type { JsonObject, ListingRow } from "../../device-service-core/src/local-api/protocol.ts"
import { defaultWorld, type World } from "../../device-service-core/test/local-api/conformance/world.ts"

// The conformance world the `omo remote` session verbs run over on the person client (#13414 4c-2), as the module's own
// session tests build it: the peer's engine endpoint takes an open, the session it makes is listed once the listing caught
// up, and every session answers a delegated command the way a session host does.

export const PEER = "dev-peer-1"
const ENDPOINT = "FAKE_endpoint_key_tst1"
export const NEW_KEY = "FAKE_session_key_test1"
const ENGINE_ID = "dur-new"

const SESSION_REPLY: JsonObject = {
  isStreaming: false,
  currentTurnId: "7",
  pendingMessageCount: 0,
  pendingDialogs: [],
  model: { provider: "anthropic", id: "claude" },
  thinkingLevel: "high",
  permissionPreset: "workspace",
  cwd: "/home/user/omo",
  disposition: "started",
  kind: "started",
  turnId: "7",
  interrupted: true,
  outcome: "unloaded",
  models: [{ provider: "anthropic", id: "claude" }],
  provider: "anthropic",
  id: "claude",
}

const openedRow = (rows: readonly ListingRow[]): ListingRow => {
  const live = rows.find((row) => row.device === PEER)
  if (live === undefined) throw new Error("the default world lists the peer's live session")
  return { ...live, session_id: NEW_KEY, title: "review", durable_id: ENGINE_ID }
}

// Rows as a current device lists them: each with the durable id the thread tools name it by.
const DURABLE: Readonly<Record<string, string>> = {
  [PEER]: "0bb00001-0000-7000-8000-000000000001",
  "dev-peer-2": "0cc00001-0000-7000-8000-000000000001",
}
export const durableOf = (device: string): string | undefined => DURABLE[device]
const withDurable = (row: ListingRow): ListingRow =>
  row.durable_id !== undefined || DURABLE[row.device] === undefined ? row : { ...row, durable_id: DURABLE[row.device] }

export const liveKey = (): string => {
  const live = defaultWorld().sessions.find((session) => session.device === PEER)
  if (live === undefined) throw new Error("the default world holds a session on the peer")
  return live.session_id
}

export const personWorld = (base: World = defaultWorld()): World => {
  const live = base.sessions.find((session) => session.device === PEER)
  if (live === undefined) throw new Error("the default world holds a session on the peer")
  const replying = { ...live, delegated: { data: SESSION_REPLY, frames: [] } }
  return {
    ...base,
    endpoints: { [PEER]: [ENDPOINT] },
    primary: { [PEER]: ENDPOINT },
    endpointCommand: {
      data: { sessionId: "engine-routing-1", state: { sessionId: ENGINE_ID, cwd: "/work" } },
      outcome: [{ state: "engine_applied", retryable: false }],
    },
    located: { [PEER]: { [ENGINE_ID]: NEW_KEY } },
    listing: {
      ...base.listing,
      revisions: base.listing.revisions.map((revision, index, all) => {
        const rows = revision.rows.map(withDurable)
        return index < all.length - 1 ? { ...revision, rows } : { ...revision, rows: [...rows, openedRow(rows)] }
      }),
    },
    sessions: [
      ...base.sessions.map((session) => (session === live ? replying : session)),
      { ...replying, session_id: NEW_KEY },
    ],
  }
}

/** The devices every command the owner took reached: `<device>/endpoint/<key>` for an open, `<device>/<session>`. */
export const commandTargets = (bindings: ReadonlyMap<string, { readonly target: string }>): string[] =>
  [...bindings.values()].map((binding) => binding.target)
