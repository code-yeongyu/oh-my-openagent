import { afterEach, describe, expect, test } from "bun:test"
import { resolveTypedAddress } from "../../remote/device-address"
import { resolveMember } from "../../remote/resolve"
import { remoteClientOn, sdkOn, type Cleanups } from "./testing/entries"
import {
  ALIAS,
  B,
  createTwoDevices,
  FIX,
  HERE,
  KEY,
  NAMES,
  ROUTE,
  T,
  type TwoDeviceOptions,
} from "./testing/two-devices"

// T1a of #14943 (#13016), deliverable 1: what every entry that resolves a thread address answers TODAY, over one shared
// table, recorded before the entries move onto one resolve function (design 7.4: a route's outcomes are pinned before its
// implementation moves). A row whose entries disagree is a finding of that slice, not a target: each change to a pin
// lands in its own commit naming the #13016 row it closes. Outcomes are "ok <device>/<thread>" or the refusal code with
// details.kind or details.reason in parentheses. Session files here are written to disk (sessionFiles), so a read or an
// open of one answers the session its header names.

const cleanups: Cleanups = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

type TD = ReturnType<typeof createTwoDevices>
const NAME_OF: Record<string, string> = {
  ...Object.fromEntries(Object.entries(T).map(([k, v]) => [v, k])),
  ...Object.fromEntries(Object.entries(KEY).map(([k, v]) => [v, `key:${k}`])),
  [HERE.id]: "HERE",
  [B.id]: "B",
  [FIX.id]: "FIX",
}
const sym = (s: unknown) => NAME_OF[String(s)] ?? String(s)
type R = Record<string, unknown>
const fail = (e: R | undefined): string => {
  const d = (e?.["details"] ?? {}) as R
  const why = d["reason"] ?? d["kind"]
  return `${String(e?.["code"])}${why === undefined ? "" : `(${String(why)})`}${e?.["code"] === "internal_error" ? ` MSG=${String(e?.["message"])}` : ""}`
}
const toolOut = (o: R): string => {
  if (o["kind"] === "error") return fail((o["error"] ?? o) as R)
  const t = o["thread"]
  if (t !== null && typeof t === "object")
    return `ok ${sym((t as R)["device"] ?? "HERE")}/${sym((t as R)["thread_id"])}`
  return `ok ${sym(o["device"] ?? HERE.id)}/${sym(t)}${o["interrupted"] === undefined ? "" : ` interrupted=${String(o["interrupted"])}`}`
}
const parsed = (address: string) => {
  const i = address.indexOf("/")
  return i < 0 ? `HERE/${sym(address)}` : `${sym(address.slice(0, i))}/${sym(address.slice(i + 1))}`
}
const ENTRIES: Record<string, (td: TD, a: string) => Promise<string>> = {
  thread_send: async (td, a) => toolOut((await td.run("thread_send", { thread: a, message: "x" })) as R),
  thread_handoff_fuzzy: async (td, a) =>
    toolOut((await td.run("thread_handoff", { thread: a, message: "x", match: "fuzzy" })) as R),
  thread_interrupt: async (td, a) => toolOut((await td.run("thread_interrupt", { thread: a })) as R),
  thread_read: async (td, a) => toolOut((await td.run("thread_read", { thread: a })) as R),
  thread_create_existing: async (td, a) => toolOut((await td.run("thread_create", { thread: a })) as R),
  monitor_target: async (td, a) => {
    const m = (await td.tools.monitorTarget(a)) as R
    if (m["kind"] === "refused") return fail(m["failure"] as R)
    return `ok ${parsed(m["kind"] === "target" ? String(m["target"]) : a)}`
  },
  sdk_send: async (td, a) => {
    const o = (await sdkOn(td, cleanups).send({ thread: a, text: "x" })) as R
    if (o["kind"] === "error") return fail(o["error"] as R)
    return `ok ${sym(o["device"] ?? HERE.id)}/${sym(o["thread"])}`
  },
  sdk_locate: async (td, a) => toolOut((await sdkOn(td, cleanups).locate({ thread: a })) as R),
  sdk_interrupt: async (td, a) => toolOut((await sdkOn(td, cleanups).interrupt({ thread: a })) as R),
  remote_sessions_resolve: async (td, a) => {
    const o = (await resolveMember(remoteClientOn(td))(a)) as R
    if (o["kind"] !== "ok") return fail(o)
    const v = o["value"] as R
    return `ok ${sym((v["device"] as R)["id"])}/${sym(v["durable_id"])}`
  },
  omo_remote_control: async (td, a) => {
    const o = (await resolveTypedAddress(td.remote, a, { need: "online" })) as R
    if (o["kind"] !== "ok") return fail(o["error"] as R)
    return `ok ${sym(((o["where"] as R)["row"] as R)["device"])}/${sym(o["thread"])} state=${String(((o["where"] as R)["row"] as R)["state"])}`
  },
  omo_remote_send: async (td, a) => {
    const o = (await resolveTypedAddress(td.remote, a, { need: "address" })) as R
    if (o["kind"] !== "ok") return fail(o["error"] as R)
    return `ok ${sym(((o["where"] as R)["row"] as R)["device"])}/${sym(o["thread"])}`
  },
}

type Entry = keyof typeof ENTRIES
type Row = {
  readonly form: string
  readonly address: string
  readonly setup?: TwoDeviceOptions
  readonly answers: Readonly<Record<Entry, string>>
}

const ROWS: readonly Row[] = [
  {
    form: "self",
    address: "self",
    answers: {
      thread_send: "loop_detected",
      thread_handoff_fuzzy: "not_found(thread)",
      thread_interrupt: "ok HERE/hereLive interrupted=false",
      thread_read: "ok HERE/hereLive",
      thread_create_existing: "ok HERE/hereLive",
      monitor_target: "ok HERE/hereLive",
      sdk_send: "caller_context_missing",
      sdk_locate: "caller_context_missing",
      sdk_interrupt: "caller_context_missing",
      remote_sessions_resolve: "caller_context_missing",
      omo_remote_control: "caller_context_missing",
      omo_remote_send: "caller_context_missing",
    },
  },
  {
    form: "the caller's own id",
    address: T.hereLive,
    answers: {
      thread_send: "loop_detected",
      thread_handoff_fuzzy: "not_found(thread)",
      thread_interrupt: "ok HERE/hereLive interrupted=false",
      thread_read: "ok HERE/hereLive",
      thread_create_existing: "ok HERE/hereLive",
      monitor_target: "ok HERE/hereLive",
      sdk_send: "ok HERE/hereLive",
      sdk_locate: "ok HERE/hereLive",
      sdk_interrupt: "ok HERE/hereLive interrupted=false",
      remote_sessions_resolve: "ok HERE/hereLive",
      omo_remote_control: "not_found(thread)",
      omo_remote_send: "not_found(thread)",
    },
  },
  {
    form: "a thread here by durable id",
    address: T.hereSlash,
    answers: {
      thread_send: "ok HERE/hereSlash",
      thread_handoff_fuzzy: "ok HERE/hereSlash",
      thread_interrupt: "ok HERE/hereSlash interrupted=false",
      thread_read: "ok HERE/hereSlash",
      thread_create_existing: "ok HERE/hereSlash",
      monitor_target: "ok HERE/hereSlash",
      sdk_send: "ok HERE/hereSlash",
      sdk_locate: "ok HERE/hereSlash",
      sdk_interrupt: "ok HERE/hereSlash interrupted=false",
      remote_sessions_resolve: "ok HERE/hereSlash",
      omo_remote_control: "not_found(thread)",
      omo_remote_send: "not_found(thread)",
    },
  },
  {
    form: "a thread on B by durable id",
    address: T.bLive,
    answers: {
      thread_send: "ok B/bLive",
      thread_handoff_fuzzy: "ok B/bLive",
      thread_interrupt: "ok B/bLive interrupted=false",
      thread_read: "ok B/bLive",
      thread_create_existing: "ok B/bLive",
      monitor_target: "ok B/bLive",
      sdk_send: "ok B/bLive",
      sdk_locate: "ok B/bLive",
      sdk_interrupt: "ok B/bLive interrupted=false",
      remote_sessions_resolve: "ok B/bLive",
      omo_remote_control: "ok B/bLive state=idle",
      omo_remote_send: "ok B/bLive",
    },
  },
  {
    form: "a thread here by session key",
    address: ROUTE.hereSlash,
    answers: {
      thread_send: "ok HERE/hereSlash",
      thread_handoff_fuzzy: "ok HERE/hereSlash",
      thread_interrupt: "ok HERE/hereSlash interrupted=false",
      thread_read: "ok HERE/hereSlash",
      thread_create_existing: "ok HERE/hereSlash",
      monitor_target: "ok HERE/hereSlash",
      sdk_send: "ok HERE/hereSlash",
      sdk_locate: "ok HERE/hereSlash",
      sdk_interrupt: "ok HERE/hereSlash interrupted=false",
      remote_sessions_resolve: "ok HERE/hereSlash",
      omo_remote_control: "not_found(thread)",
      omo_remote_send: "not_found(thread)",
    },
  },
  {
    form: "a thread on B by listing key",
    address: KEY.bLive,
    answers: {
      thread_send: "ok B/bLive",
      thread_handoff_fuzzy: "ok B/bLive",
      thread_interrupt: "ok B/bLive interrupted=false",
      thread_read: "ok B/bLive",
      thread_create_existing: "ok B/bLive",
      monitor_target: "ok B/bLive",
      sdk_send: "ok B/bLive",
      sdk_locate: "ok B/bLive",
      sdk_interrupt: "ok B/bLive interrupted=false",
      remote_sessions_resolve: "ok B/bLive",
      omo_remote_control: "ok B/bLive state=idle",
      omo_remote_send: "ok B/bLive",
    },
  },
  {
    form: "an alias held on B",
    address: ALIAS.onB,
    answers: {
      thread_send: "ok B/bLive",
      thread_handoff_fuzzy: "ok B/bLive",
      thread_interrupt: "ok B/bLive interrupted=false",
      thread_read: "ok B/bLive",
      thread_create_existing: "ok B/bLive",
      monitor_target: "ok B/bLive",
      sdk_send: "ok B/bLive",
      sdk_locate: "ok B/bLive",
      sdk_interrupt: "ok B/bLive interrupted=false",
      remote_sessions_resolve: "ok B/bLive",
      omo_remote_control: "ok B/bLive state=idle",
      omo_remote_send: "ok B/bLive",
    },
  },
  {
    form: "an alias held here (the caller)",
    address: ALIAS.here,
    answers: {
      thread_send: "loop_detected",
      thread_handoff_fuzzy: "not_found(thread)",
      thread_interrupt: "ok HERE/hereLive interrupted=false",
      thread_read: "ok HERE/hereLive",
      thread_create_existing: "ok HERE/hereLive",
      monitor_target: "ok HERE/hereLive",
      sdk_send: "ok HERE/hereLive",
      sdk_locate: "ok HERE/hereLive",
      sdk_interrupt: "ok HERE/hereLive interrupted=false",
      remote_sessions_resolve: "ok HERE/hereLive",
      omo_remote_control: "not_found(thread)",
      omo_remote_send: "not_found(thread)",
    },
  },
  {
    form: "an exact name here",
    address: NAMES.hereLive,
    answers: {
      thread_send: "loop_detected",
      thread_handoff_fuzzy: "not_found(thread)",
      thread_interrupt: "ok HERE/hereLive interrupted=false",
      thread_read: "ok HERE/hereLive",
      thread_create_existing: "ok HERE/hereLive",
      monitor_target: "ok HERE/hereLive",
      sdk_send: "ok HERE/hereLive",
      sdk_locate: "ok HERE/hereLive",
      sdk_interrupt: "ok HERE/hereLive interrupted=false",
      remote_sessions_resolve: "ok HERE/hereLive",
      omo_remote_control: "not_found(thread)",
      omo_remote_send: "not_found(thread)",
    },
  },
  {
    form: "an exact name on B",
    address: NAMES.bLive,
    answers: {
      thread_send: "ok B/bLive",
      thread_handoff_fuzzy: "ok B/bLive",
      thread_interrupt: "ok B/bLive interrupted=false",
      thread_read: "ok B/bLive",
      thread_create_existing: "ok B/bLive",
      monitor_target: "ok B/bLive",
      sdk_send: "ok B/bLive",
      sdk_locate: "ok B/bLive",
      sdk_interrupt: "ok B/bLive interrupted=false",
      remote_sessions_resolve: "ok B/bLive",
      omo_remote_control: "ok B/bLive state=idle",
      omo_remote_send: "ok B/bLive",
    },
  },
  {
    form: "a unique id prefix on B",
    address: T.bLive.slice(0, 8),
    answers: {
      thread_send: "ok B/bLive",
      thread_handoff_fuzzy: "ok B/bLive",
      thread_interrupt: "ok B/bLive interrupted=false",
      thread_read: "ok B/bLive",
      thread_create_existing: "ok B/bLive",
      monitor_target: "ok B/bLive",
      sdk_send: "ok B/bLive",
      sdk_locate: "ok B/bLive",
      sdk_interrupt: "ok B/bLive interrupted=false",
      remote_sessions_resolve: "ok B/bLive",
      omo_remote_control: "ok B/bLive state=idle",
      omo_remote_send: "ok B/bLive",
    },
  },
  {
    form: "an ambiguous id prefix on B",
    address: T.bLive.slice(0, 8),
    setup: { prefixTwin: true },
    answers: {
      thread_send: "ambiguous_target(thread)",
      thread_handoff_fuzzy: "ambiguous_target(thread)",
      thread_interrupt: "ambiguous_target(thread)",
      thread_read: "ambiguous_target(thread)",
      thread_create_existing: "ambiguous_target(thread)",
      monitor_target: "ambiguous_target(thread)",
      sdk_send: "ambiguous_target(thread)",
      sdk_locate: "ambiguous_target(thread)",
      sdk_interrupt: "ambiguous_target(thread)",
      remote_sessions_resolve: "ambiguous_target",
      omo_remote_control: "ambiguous_target(thread)",
      omo_remote_send: "ambiguous_target(thread)",
    },
  },
  {
    form: "a name both devices carry",
    address: NAMES.shared,
    answers: {
      thread_send: "ambiguous_target(thread)",
      thread_handoff_fuzzy: "ambiguous_target(thread)",
      thread_interrupt: "ambiguous_target(thread)",
      thread_read: "ambiguous_target(thread)",
      thread_create_existing: "ambiguous_target(thread)",
      monitor_target: "ambiguous_target(thread)",
      sdk_send: "ambiguous_target(thread)",
      sdk_locate: "ambiguous_target(thread)",
      sdk_interrupt: "ambiguous_target(thread)",
      remote_sessions_resolve: "ambiguous_target",
      omo_remote_control: "ok B/bShared state=idle",
      omo_remote_send: "ok B/bShared",
    },
  },
  {
    form: "<device id>/<thread id>",
    address: `${B.id}/${T.bLive}`,
    answers: {
      thread_send: "ok B/bLive",
      thread_handoff_fuzzy: "ok B/bLive",
      thread_interrupt: "ok B/bLive interrupted=false",
      thread_read: "ok B/bLive",
      thread_create_existing: "ok B/bLive",
      monitor_target: "ok B/bLive",
      sdk_send: "ok B/bLive",
      sdk_locate: "ok B/bLive",
      sdk_interrupt: "ok B/bLive interrupted=false",
      remote_sessions_resolve: "ok B/bLive",
      omo_remote_control: "ok B/bLive state=idle",
      omo_remote_send: "ok B/bLive",
    },
  },
  {
    form: "here/<thread name>",
    address: `here/${NAMES.slash}`,
    answers: {
      thread_send: "not_found(thread)",
      thread_handoff_fuzzy: "ok HERE/hereSlash",
      thread_interrupt: "not_found(thread)",
      thread_read: "not_found(thread)",
      thread_create_existing: "not_found(thread)",
      monitor_target: "ok here/fix/login",
      sdk_send: "not_found(thread)",
      sdk_locate: "not_found(thread)",
      sdk_interrupt: "not_found(thread)",
      remote_sessions_resolve: "not_found(session)",
      omo_remote_control: "not_found(thread)",
      omo_remote_send: "not_found(thread)",
    },
  },
  {
    form: "<device name>/<thread name>",
    address: `${B.name}/${NAMES.bLive}`,
    answers: {
      thread_send: "ok B/bLive",
      thread_handoff_fuzzy: "ok B/bLive",
      thread_interrupt: "ok B/bLive interrupted=false",
      thread_read: "ok B/bLive",
      thread_create_existing: "ok B/bLive",
      monitor_target: "ok B/bLive",
      sdk_send: "ok B/bLive",
      sdk_locate: "ok B/bLive",
      sdk_interrupt: "ok B/bLive interrupted=false",
      remote_sessions_resolve: "ok B/bLive",
      omo_remote_control: "ok B/bLive state=idle",
      omo_remote_send: "ok B/bLive",
    },
  },
  {
    form: "<device id prefix>/<thread id>",
    address: `${B.id.slice(0, 6)}/${T.bLive}`,
    answers: {
      thread_send: "ok B/bLive",
      thread_handoff_fuzzy: "ok B/bLive",
      thread_interrupt: "ok B/bLive interrupted=false",
      thread_read: "ok B/bLive",
      thread_create_existing: "ok B/bLive",
      monitor_target: "ok B/bLive",
      sdk_send: "ok B/bLive",
      sdk_locate: "ok B/bLive",
      sdk_interrupt: "ok B/bLive interrupted=false",
      remote_sessions_resolve: "ok B/bLive",
      omo_remote_control: "ok B/bLive state=idle",
      omo_remote_send: "ok B/bLive",
    },
  },
  {
    form: "a device name two devices share",
    address: `${B.name}/${T.bLive}`,
    setup: { twin: true },
    answers: {
      thread_send: "ambiguous_target(device)",
      thread_handoff_fuzzy: "ambiguous_target(device)",
      thread_interrupt: "ambiguous_target(device)",
      thread_read: "ambiguous_target(device)",
      thread_create_existing: "ambiguous_target(device)",
      monitor_target: "ambiguous_target(device)",
      sdk_send: "ambiguous_target(device)",
      sdk_locate: "ambiguous_target(device)",
      sdk_interrupt: "ambiguous_target(device)",
      remote_sessions_resolve: "ambiguous_target(device)",
      omo_remote_control: "ambiguous_target(device)",
      omo_remote_send: "ambiguous_target(device)",
    },
  },
  {
    form: "<this device's id>/<thread id>",
    address: `${HERE.id}/${T.hereSlash}`,
    answers: {
      thread_send: "ok HERE/hereSlash",
      thread_handoff_fuzzy: "ok HERE/hereSlash",
      thread_interrupt: "ok HERE/hereSlash interrupted=false",
      thread_read: "ok HERE/hereSlash",
      thread_create_existing: "ok HERE/hereSlash",
      monitor_target: "ok HERE/hereSlash",
      sdk_send: "ok HERE/hereSlash",
      sdk_locate: "ok HERE/hereSlash",
      sdk_interrupt: "ok HERE/hereSlash interrupted=false",
      remote_sessions_resolve: "ok HERE/hereSlash",
      omo_remote_control: "not_found(thread)",
      omo_remote_send: "not_found(thread)",
    },
  },
  {
    form: "text with a slash naming no device",
    address: NAMES.slash,
    answers: {
      thread_send: "ok HERE/hereSlash",
      thread_handoff_fuzzy: "ok HERE/hereSlash",
      thread_interrupt: "ok HERE/hereSlash interrupted=false",
      thread_read: "ok HERE/hereSlash",
      thread_create_existing: "ok HERE/hereSlash",
      monitor_target: "ok HERE/hereSlash",
      sdk_send: "ok HERE/hereSlash",
      sdk_locate: "ok HERE/hereSlash",
      sdk_interrupt: "ok HERE/hereSlash interrupted=false",
      remote_sessions_resolve: "ok HERE/hereSlash",
      omo_remote_control: "not_found(device)",
      omo_remote_send: "not_found(device)",
    },
  },
  {
    form: "text with a slash whose first part names a device",
    address: NAMES.slash,
    setup: { fix: true },
    answers: {
      thread_send: "ambiguous_target(thread)",
      thread_handoff_fuzzy: "ambiguous_target(thread)",
      thread_interrupt: "ambiguous_target(thread)",
      thread_read: "ambiguous_target(thread)",
      thread_create_existing: "ambiguous_target(thread)",
      monitor_target: "ambiguous_target(thread)",
      sdk_send: "ambiguous_target(thread)",
      sdk_locate: "ambiguous_target(thread)",
      sdk_interrupt: "ambiguous_target(thread)",
      remote_sessions_resolve: "ok FIX/fixLogin",
      omo_remote_control: "ok FIX/fixLogin state=idle",
      omo_remote_send: "ok FIX/fixLogin",
    },
  },
  {
    form: "a thread id held here (stale copy) and live on B",
    address: T.stale,
    answers: {
      thread_send: "ok HERE/stale",
      thread_handoff_fuzzy: "ok HERE/stale",
      thread_interrupt: "not_resumable",
      thread_read: "ok HERE/stale",
      thread_create_existing: "ok HERE/stale",
      monitor_target: "ok HERE/stale",
      sdk_send: "ok HERE/stale",
      sdk_locate: "ok B/stale",
      sdk_interrupt: "not_resumable",
      remote_sessions_resolve: "ok B/stale",
      omo_remote_control: "ok B/stale state=idle",
      omo_remote_send: "ok B/stale",
    },
  },
  {
    form: "an ended session here",
    address: T.hereEnded,
    answers: {
      thread_send: "ok HERE/hereEnded",
      thread_handoff_fuzzy: "ok HERE/hereEnded",
      thread_interrupt: "not_resumable",
      thread_read: "ok HERE/hereEnded",
      thread_create_existing: "ok HERE/hereEnded",
      monitor_target: "ok HERE/hereEnded",
      sdk_send: "ok HERE/hereEnded",
      sdk_locate: "not_found(thread)",
      sdk_interrupt: "not_resumable",
      remote_sessions_resolve: "not_found(session)",
      omo_remote_control: "not_found(thread)",
      omo_remote_send: "not_found(thread)",
    },
  },
  {
    form: "an ended session on B",
    address: T.bEnded,
    answers: {
      thread_send: "ok B/bEnded",
      thread_handoff_fuzzy: "ok B/bEnded",
      thread_interrupt: "not_resumable",
      thread_read: "ok B/bEnded",
      thread_create_existing: "ok B/bEnded",
      monitor_target: "ok B/bEnded",
      sdk_send: "ok B/bEnded",
      sdk_locate: "ok B/bEnded",
      sdk_interrupt: "not_resumable",
      remote_sessions_resolve: "ok B/bEnded",
      omo_remote_control: "ok B/bEnded state=ended",
      omo_remote_send: "ok B/bEnded",
    },
  },
  {
    form: "an id no device holds",
    address: T.nowhere,
    answers: {
      thread_send: "not_found(thread)",
      thread_handoff_fuzzy: "not_found(thread)",
      thread_interrupt: "not_found(thread)",
      thread_read: "not_found(thread)",
      thread_create_existing: "not_found(thread)",
      monitor_target: "not_found(thread)",
      sdk_send: "not_found(thread)",
      sdk_locate: "not_found(thread)",
      sdk_interrupt: "not_found(thread)",
      remote_sessions_resolve: "not_found(session)",
      omo_remote_control: "not_found(thread)",
      omo_remote_send: "not_found(thread)",
    },
  },
  {
    form: "a reply to a sender here, by id",
    address: T.hereSlash,
    setup: { replySenders: [{ session_id: T.hereSlash }] },
    answers: {
      thread_send: "ok HERE/hereSlash",
      thread_handoff_fuzzy: "ok HERE/hereSlash",
      thread_interrupt: "ok HERE/hereSlash interrupted=false",
      thread_read: "ok HERE/hereSlash",
      thread_create_existing: "ok HERE/hereSlash",
      monitor_target: "ok HERE/hereSlash",
      sdk_send: "ok HERE/hereSlash",
      sdk_locate: "ok HERE/hereSlash",
      sdk_interrupt: "ok HERE/hereSlash interrupted=false",
      remote_sessions_resolve: "ok HERE/hereSlash",
      omo_remote_control: "not_found(thread)",
      omo_remote_send: "not_found(thread)",
    },
  },
  {
    form: "a reply to a sender here in another workspace",
    address: T.hereSlash,
    setup: { replySenders: [{ session_id: T.hereSlash }], callerWorkspaceRoot: "/elsewhere" },
    answers: {
      thread_send: "ok HERE/hereSlash",
      thread_handoff_fuzzy: "not_found(thread)",
      thread_interrupt: "scope_denied",
      thread_read: "scope_denied",
      thread_create_existing: "ok HERE/hereSlash",
      monitor_target: "ok HERE/hereSlash",
      sdk_send: "ok HERE/hereSlash",
      sdk_locate: "ok HERE/hereSlash",
      sdk_interrupt: "ok HERE/hereSlash interrupted=false",
      remote_sessions_resolve: "ok HERE/hereSlash",
      omo_remote_control: "not_found(thread)",
      omo_remote_send: "not_found(thread)",
    },
  },
  {
    form: "a reply to a sender on B",
    address: T.bLive,
    setup: { replySenders: [{ session_id: T.bLive, device: B.id }] },
    answers: {
      thread_send: "ok B/bLive",
      thread_handoff_fuzzy: "ok B/bLive",
      thread_interrupt: "ok B/bLive interrupted=false",
      thread_read: "ok B/bLive",
      thread_create_existing: "ok B/bLive",
      monitor_target: "ok B/bLive",
      sdk_send: "ok B/bLive",
      sdk_locate: "ok B/bLive",
      sdk_interrupt: "ok B/bLive interrupted=false",
      remote_sessions_resolve: "ok B/bLive",
      omo_remote_control: "ok B/bLive state=idle",
      omo_remote_send: "ok B/bLive",
    },
  },
  {
    form: "a reply to a renamed sender here, by its stated name",
    address: "old name",
    setup: { replySenders: [{ session_id: T.hereSlash, name: "old name" }] },
    answers: {
      thread_send: "ok HERE/hereSlash",
      thread_handoff_fuzzy: "not_found(thread)",
      thread_interrupt: "not_found(thread)",
      thread_read: "not_found(thread)",
      thread_create_existing: "not_found(thread)",
      monitor_target: "not_found(thread)",
      sdk_send: "not_found(thread)",
      sdk_locate: "not_found(thread)",
      sdk_interrupt: "not_found(thread)",
      remote_sessions_resolve: "not_found(session)",
      omo_remote_control: "not_found(thread)",
      omo_remote_send: "not_found(thread)",
    },
  },
  {
    form: "an id prefix of a consumed sender here (a prefix names no sender, so it is no reply)",
    address: T.hereSlash.slice(0, 8),
    setup: { replySenders: [{ session_id: T.hereSlash }] },
    answers: {
      thread_send: "ok HERE/hereSlash",
      thread_handoff_fuzzy: "ok HERE/hereSlash",
      thread_interrupt: "ok HERE/hereSlash interrupted=false",
      thread_read: "ok HERE/hereSlash",
      thread_create_existing: "ok HERE/hereSlash",
      monitor_target: "ok HERE/hereSlash",
      sdk_send: "ok HERE/hereSlash",
      sdk_locate: "ok HERE/hereSlash",
      sdk_interrupt: "ok HERE/hereSlash interrupted=false",
      remote_sessions_resolve: "ok HERE/hereSlash",
      omo_remote_control: "not_found(thread)",
      omo_remote_send: "not_found(thread)",
    },
  },
]

describe("T1a deliverable 1: every resolving entry over one address table, as it answers today", () => {
  test.each(ROWS.flatMap((row) => (Object.keys(ENTRIES) as Entry[]).map((entry) => [row.form, entry, row] as const)))(
    "#given %s #when %s resolves it #then it answers its pinned outcome",
    async (_form, entry, row) => {
      const td = createTwoDevices({ ...row.setup, sessionFiles: true })
      cleanups.push(td.cleanup)
      expect(await ENTRIES[entry](td, row.address)).toBe(row.answers[entry])
    },
  )
})
