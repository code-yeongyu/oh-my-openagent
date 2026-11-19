import type { ThreadAddressEntry } from "../../addressing"
import type {
  AliasHolder,
  RemoteDevice,
  RemoteListing,
  RemoteSessionRow,
  RemoteThreadSurface,
} from "../../remote/ports"
import { createRemoteThreadFixture } from "../../thread-remote-fixture"
import type { ThreadHostSession } from "../../tools"

// Two devices of one account for the address module (#14305): this device ("here", the fixture's own id) and device B,
// each with a live thread, an ended thread, a thread whose routing key differs from its durable id, one thread name both
// share and one thread id both hold (a stale copy here, live on B). A third device is offline. Built on
// createRemoteThreadFixture without changing it: every option below is one of its own.

export const HERE = { id: "here", name: "this mac" } as const
export const B = { id: "b7c41e09d2a64f1e", name: "Studio Laptop" } as const
/** A second online device carrying B's name, for the ambiguous device name. */
export const B_TWIN = { id: "b7c4ffff00000000", name: "Studio Laptop" } as const
export const OFF = { id: "c0ffee5a1d2b3c4d", name: "attic", last_seen_ms: 1_699_000_000_000 } as const
/** A device whose name is the first part of a thread name that contains "/" ("fix/login"). */
export const FIX = { id: "f1c5d00e77a8b9c0", name: "fix" } as const

export const T = {
  hereLive: "0aa00001-0000-4000-8000-000000000001",
  hereEnded: "0aa00002-0000-4000-8000-000000000002",
  hereShared: "0aa00003-0000-4000-8000-000000000003",
  hereSlash: "0aa00004-0000-4000-8000-000000000004",
  bLive: "0bb00001-0000-4000-8000-000000000001",
  bEnded: "0bb00002-0000-4000-8000-000000000002",
  bShared: "0bb00003-0000-4000-8000-000000000003",
  /** Held on B's disk, listed nowhere: only B's single probe finds it. */
  bProbe: "0bb00004-0000-4000-8000-000000000004",
  /** A thread id no device holds. */
  nowhere: "0ee00001-0000-4000-8000-000000000001",
  /** Live on B; a closed copy of the same id sits on this device (a stale copy). */
  stale: "0dd00001-0000-4000-8000-000000000001",
  fixLogin: "0ff00001-0000-4000-8000-000000000001",
} as const

/** B's listing keys: each differs from its durable id. */
export const KEY = {
  bLive: "rk-b-live",
  bEnded: "rk-b-ended",
  bShared: "rk-b-shared",
  bProbe: "rk-b-probe",
  stale: "rk-stale-on-b",
  fixLogin: "rk-fix-login",
} as const

/** This device's routing ids: each differs from its durable id. */
export const ROUTE = { hereLive: "route-here-live", hereShared: "route-here-shared", hereSlash: "route-here-slash" }

export const NAMES = { hereLive: "alpha", bLive: "beta", bEnded: "beta old", shared: "shared", slash: "fix/login" }
export const ALIAS = { onB: "lane-b", here: "lane-here" } as const

const UPDATED = 1_700_000_000_000

const row = (id: string, key: string, title: string, state = "idle", device: string = B.id): RemoteSessionRow => ({
  device,
  session_id: key,
  durable_id: id,
  title,
  project: "/work/b",
  path: "/work/b",
  state,
  updated_ms: UPDATED,
})

const B_ROWS: readonly RemoteSessionRow[] = [
  row(T.bLive, KEY.bLive, NAMES.bLive),
  row(T.bEnded, KEY.bEnded, NAMES.bEnded, "ended"),
  row(T.bShared, KEY.bShared, NAMES.shared),
  row(T.stale, KEY.stale, "stale live"),
]
const FIX_ROW = row(T.fixLogin, KEY.fixLogin, "login", "idle", FIX.id)

const session = (id: string, route: string, name: string): ThreadHostSession => ({
  sessionId: route,
  durableSessionId: id,
  cwd: process.cwd(),
  name,
  status: "open",
})

/** This device's live sessions, as its endpoint lists them. */
const HERE_SESSIONS: readonly ThreadHostSession[] = [
  session(T.hereLive, ROUTE.hereLive, NAMES.hereLive),
  session(T.hereShared, ROUTE.hereShared, NAMES.shared),
  session(T.hereSlash, ROUTE.hereSlash, NAMES.slash),
]
/** Session files on this device that no engine runs: an ended thread and the stale copy of B's live thread. */
const HERE_DISK: readonly string[] = [T.hereEnded, T.stale]

const live = (id: string, route: string, name: string): ThreadAddressEntry => ({
  thread_id: id,
  name,
  status: "live",
  cwd: process.cwd(),
  created_at: "2026-11-01T00:00:00Z",
  updated_at: null,
  session_ids: [route],
})
const stored = (id: string): ThreadAddressEntry => ({
  thread_id: id,
  name: "",
  status: "resumable",
  cwd: process.cwd(),
  created_at: "2026-11-01T00:00:00Z",
  updated_at: null,
})

/** The same threads as this device's address book holds them, for resolving without the tools. */
const HERE_ENTRIES: readonly ThreadAddressEntry[] = [
  live(T.hereLive, ROUTE.hereLive, NAMES.hereLive),
  live(T.hereShared, ROUTE.hereShared, NAMES.shared),
  live(T.hereSlash, ROUTE.hereSlash, NAMES.slash),
  ...HERE_DISK.map(stored),
]

export type TwoDeviceOptions = {
  /** B misses this listing round: the listing names it incomplete and carries none of its rows. */
  readonly incomplete?: boolean
  /** B answers the first round and misses every later one (#14172). */
  readonly dropsAfterFirstRound?: boolean
  /** B is offline in the roster. */
  readonly bOffline?: boolean
  /** A second online device named like B. */
  readonly twin?: boolean
  /** A device named "fix" holding a thread named "login". */
  readonly fix?: boolean
  /** This device's service makes the single probe and may build an ended row (both omo#13037 gates open). */
  readonly probe?: boolean
  /** Devices that do not answer the single probe. */
  readonly silent?: readonly string[]
  /** The device service state (default connected). */
  readonly plan?: string
}

/**
 * The account of the two devices and this device's tool surface over it. `remote` is the account as every reader sees
 * it; `run` calls a real thread tool on this device; `entries` is this device's address book for resolving directly.
 */
export function createTwoDevices(options: TwoDeviceOptions = {}) {
  const fixture = createRemoteThreadFixture()
  const devices: RemoteDevice[] = [
    { device: B.id, label: B.name, online: options.bOffline !== true },
    { device: OFF.id, label: OFF.name, online: false, last_seen_ms: OFF.last_seen_ms },
    ...(options.twin === true ? [{ device: B_TWIN.id, label: B_TWIN.name, online: true }] : []),
    ...(options.fix === true ? [{ device: FIX.id, label: FIX.name, online: true }] : []),
  ]
  const rows = [...B_ROWS, ...(options.fix === true ? [FIX_ROW] : [])]
  const aliases = new Map<string, AliasHolder>([
    [ALIAS.onB, { session_id: T.bLive, device: B.id }],
    [ALIAS.here, { session_id: T.hereLive, device: HERE.id }],
  ])
  const account = fixture.account({
    rows,
    devices,
    aliases,
    live: [...rows.map((entry) => entry.session_id), ...rows.flatMap((entry) => entry.durable_id ?? [])],
    ...(options.incomplete === true ? { incomplete: [B.id] } : {}),
    ...(options.plan === undefined ? {} : { plan: options.plan }),
    ...(options.probe === true ? { wakeFeature: true, ended: { [B.id]: { [T.bProbe]: KEY.bProbe } } } : {}),
    ...(options.silent === undefined ? {} : { silent: options.silent }),
  })
  const withoutB = (listing: RemoteListing): RemoteListing => ({
    rows: listing.rows.filter((entry) => entry.device !== B.id),
    incomplete: [...new Set([...listing.incomplete, B.id])],
  })
  let round = 0
  const listing = account.remote.sessions.listing
  const remote: RemoteThreadSurface =
    listing === undefined || (options.incomplete !== true && options.dropsAfterFirstRound !== true)
      ? account.remote
      : {
          ...account.remote,
          sessions: {
            ...account.remote.sessions,
            listing: async () => {
              const full = await listing()
              round += 1
              return options.incomplete === true || round > 1 ? withoutB(full) : full
            },
          },
        }
  const tools = fixture.surface(remote, {
    sessions: [...HERE_SESSIONS],
    diskSessions: HERE_DISK,
    caller: T.hereLive,
  })
  return { account, remote, run: tools.run, tools, entries: HERE_ENTRIES, cleanup: fixture.cleanup }
}
