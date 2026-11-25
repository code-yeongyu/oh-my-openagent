import { afterEach, describe, expect, test } from "bun:test"
import { resolve, type ResolveRequest } from "./contract"
import { B, createTwoDevices, HERE, NAMES, T, type TwoDeviceOptions } from "./testing/two-devices"

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

const NAME_OF: Record<string, string> = {
  ...Object.fromEntries(Object.entries(T).map(([key, value]) => [value, key])),
  [HERE.id]: "HERE",
  [B.id]: "B",
}
const sym = (value: string): string => NAME_OF[value] ?? value

/** A session principal that is not one of the fixture's threads, so no thread is excluded as the caller. */
const SESSION = { kind: "session", id: "0cc00001-0000-4000-8000-000000000001" } as const
const DELIVER: ResolveRequest = { operation: "deliver", principal: SESSION }

type Row = {
  readonly rule: string
  readonly address: string
  readonly request: ResolveRequest
  readonly setup?: TwoDeviceOptions & { readonly workspace?: string }
  readonly want: string
}

// Each row of design section 5's policy table, as a test of resolve itself.
const ROWS: readonly Row[] = [
  { rule: "exact: a partial name is not a name", address: "alph", request: DELIVER, want: "not_found" },
  {
    rule: "fuzzy (hand-off only): a partial name ranks to its leader",
    address: "alph",
    request: { ...DELIVER, match: "fuzzy" },
    want: "local HERE/hereLive",
  },
  {
    rule: "a reply resolves to the sender it answers, by id",
    address: T.hereSlash,
    request: { ...DELIVER, reply: [{ session_id: T.hereSlash }] },
    want: "local HERE/hereSlash",
  },
  {
    rule: "a reply resolves to the sender it answers, by its stated name",
    address: NAMES.hereLive,
    request: { ...DELIVER, reply: [{ session_id: T.hereLive, name: NAMES.hereLive }] },
    want: "local HERE/hereLive",
  },
  {
    rule: "a reply whose address resolves to another thread is refused by name, without sending",
    address: NAMES.hereLive,
    request: { ...DELIVER, reply: [{ session_id: T.hereSlash, name: NAMES.hereLive }] },
    want: "reply_target_mismatch",
  },
  {
    rule: "a reply to a sender on another device is pinned to that device",
    address: T.bLive,
    request: { ...DELIVER, reply: [{ session_id: T.bLive, device: B.id }] },
    want: "relay B/bLive all_scope",
  },
  {
    rule: "the reply grant: a sender here in another workspace is answered without all_scope",
    address: T.hereSlash,
    request: { ...DELIVER, reply: [{ session_id: T.hereSlash }] },
    setup: { workspace: "/elsewhere" },
    want: "local HERE/hereSlash all_scope",
  },
  {
    rule: "without the reply grant, another workspace's thread is a scope refusal",
    address: NAMES.hereLive,
    request: DELIVER,
    setup: { workspace: "/elsewhere" },
    want: "scope_denied",
  },
  {
    rule: "all_scope widens this device's workspace scope",
    address: NAMES.hereLive,
    request: { ...DELIVER, scope: { all_scope: true } },
    setup: { workspace: "/elsewhere" },
    want: "local HERE/hereLive all_scope",
  },
  {
    rule: "a sender this device does not hold is looked up account-wide",
    address: T.bLive,
    request: { ...DELIVER, reply: [{ session_id: T.bLive }] },
    want: "relay B/bLive all_scope",
  },
  {
    rule: "a renamed sender is answered through its recorded id",
    address: "old name",
    request: { ...DELIVER, reply: [{ session_id: T.hereSlash, name: "old name" }] },
    want: "local HERE/hereSlash all_scope",
  },
  {
    rule: "a send never targets its own caller by an id prefix",
    address: T.hereLive.slice(0, 8),
    request: { ...DELIVER, principal: { kind: "session", id: T.hereLive }, id_prefix: { exclude: T.hereLive } },
    want: "not_found",
  },
  {
    rule: "self resolves for a session principal",
    address: "self",
    request: { ...DELIVER, principal: { kind: "session", id: T.hereLive } },
    want: "local HERE/hereLive",
  },
  {
    rule: "self is caller_context_missing for a script",
    address: "self",
    request: { operation: "locate", principal: { kind: "script" } },
    want: "caller_context_missing",
  },
  {
    rule: "text with a slash naming no device is a bare address",
    address: NAMES.slash,
    request: DELIVER,
    want: "local HERE/hereSlash",
  },
  {
    rule: "text with a slash both a device and this device's book answer is ambiguous",
    address: NAMES.slash,
    request: DELIVER,
    setup: { fix: true },
    want: "ambiguous_target",
  },
  {
    rule: "a device reading names the thread on that device",
    address: `${B.name}/${NAMES.bLive}`,
    request: DELIVER,
    want: "relay B/bLive all_scope",
  },
  {
    rule: "without unique_holder the ladder's order decides (this device first)",
    address: T.stale,
    request: DELIVER,
    want: "local HERE/stale",
  },
  {
    rule: "with unique_holder a second holder is ambiguous",
    address: T.stale,
    request: { ...DELIVER, unique_holder: true },
    want: "ambiguous_target",
  },
]

describe("resolve: design section 5's policy table", () => {
  test.each(ROWS.map((row) => [row.rule, row] as const))(
    "%s",
    async (_rule, row) => {
      const td = createTwoDevices(row.setup)
      cleanups.push(td.cleanup)
      const resolved = await resolve(
        { remote: td.remote, workspace: row.setup?.workspace ?? process.cwd(), book: () => td.entries },
        row.address,
        row.request,
      )
      const got =
        resolved.kind === "error"
          ? resolved.code
          : `${resolved.leg} ${sym(resolved.device?.id ?? HERE.id)}/${sym(resolved.id)}${resolved.all_scope === true ? " all_scope" : ""}`
      expect(got).toBe(row.want)
    },
    60_000,
  )
})
