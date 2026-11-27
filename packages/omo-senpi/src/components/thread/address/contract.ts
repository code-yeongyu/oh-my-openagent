import type { DeviceRef } from "@oh-my-opencode/thread-address-core"
import type { ThreadAddressEntry } from "../addressing"
import type { ThreadToolFailure } from "../errors"
import type { RemoteThreadSurface } from "../remote/ports"
import { UNKNOWN_CALLER } from "../tools/ports"
import type { ResolvePrincipal } from "./principal"
import { asRefusal, type ThreadRefusal } from "./refusals"
import { replySender, replyTargetFailure, replyTargetMismatch, thisDeviceOf, type ReplySender } from "./reply"
import { resolveAddress } from "./resolve"
import type { Resolution, Resolved, ResolveOptions } from "./types"

/** What the caller is about to do with the thread (design section 5): it names the call, never a branch in an adapter. */
export type ResolveOperation =
  "deliver" | "control" | "read" | "attach" | "open_existing" | "fork_source" | "locate" | "resolve"

export type { ResolvePrincipal } from "./principal"

export type { ReplySender } from "./reply"

export type ResolveRequest = {
  readonly operation: ResolveOperation
  readonly principal: ResolvePrincipal
  readonly scope?: { readonly all_scope?: boolean }
  /** `online`: a thread on a device that is offline is device_offline. */
  readonly need?: "online" | "any"
  /** `fuzzy` only for a hand-off; every other operation is exact. */
  readonly match?: "exact" | "fuzzy"
  /** The senders this address was approved as a reply to; absent or empty when the call is no reply. */
  readonly reply?: readonly ReplySender[]
  /** This device's id as the caller already read it for the same call (undefined: no account; a failure: unreadable). */
  readonly here?: string | undefined | ThreadToolFailure
  readonly id_prefix?: ResolveOptions["id_prefix"]
  readonly unique_holder?: boolean
  readonly probe?: boolean
}

/**
 * Where resolve reads: the account (absent = this device only), the caller's workspace, and this device's ONE book (the
 * send address book, session files included) as asked for one address; `fuzzyBook` is the whole book a hand-off ranks.
 */
export type ResolveSources = {
  readonly remote: RemoteThreadSurface | undefined
  readonly workspace: string
  readonly book: (address: string) => readonly ThreadAddressEntry[]
  readonly fuzzyBook?: () => readonly ThreadAddressEntry[]
}

export type ResolveOk = {
  readonly kind: "ok"
  /** The canonical string every surface takes back: `<device id>/<thread>`, or the thread id alone with no account. */
  readonly thread: string
  /** The thread id (empty for a session on another device that publishes none). */
  readonly id: string
  readonly device: DeviceRef | null
  readonly holder: Resolved["where"]
  /** Which transport reaches it. */
  readonly leg: "local" | "relay"
  readonly all_scope: boolean | undefined
  readonly entry: ThreadAddressEntry
  readonly resolution: Resolution
}

/**
 * The one resolution contract (design section 5): every entry that names a thread by text comes here. The policy the
 * tools' delivery locator carried is the contract's: a reply resolves only to the sender of the delivery it answers (on
 * that sender's device when it names one), the reply grant widens only a scope refusal and only to that sender, a sender
 * this device does not hold is looked up account-wide with one holder, a renamed sender is answered through its recorded
 * id, and `self` resolves only for a session principal.
 */
export async function resolve(
  sources: ResolveSources,
  address: string,
  request: ResolveRequest,
): Promise<ResolveOk | ThreadRefusal> {
  const match = request.match ?? "exact"
  const scope = request.scope?.all_scope
  const callerId = request.principal.kind === "session" ? request.principal.id : UNKNOWN_CALLER
  const senders = match === "exact" ? (request.reply ?? []) : []
  const here = "here" in request ? request.here : await thisDeviceOf(sources.remote, senders)
  if (typeof here === "object") return asRefusal(here)
  const replyTo = replySender(address, senders, here)
  if (replyTo !== undefined && "code" in replyTo) return asRefusal(replyTo)
  const replyHere = replyTo !== undefined && replyTo.device === undefined
  const context = (local: readonly ThreadAddressEntry[], account = true) => ({
    remote: account ? sources.remote : undefined,
    callerWorkspaceRoot: sources.workspace,
    local,
    ...(match === "fuzzy" ? {} : { localFor: sources.book }),
    callerId,
  })
  const need = request.need === "online" ? { need: "online" as const } : {}
  const refuseMismatch = (resolved: Resolved): ThreadRefusal | undefined => {
    const mismatch = replyTargetMismatch(senders, address, resolved.entry, here)
    return mismatch === undefined ? undefined : asRefusal(mismatch)
  }
  if (replyTo?.device !== undefined) {
    const pinned = await resolveAddress(context([]), address, {
      pin: { device: replyTo.device, thread: replyTo.session_id },
    })
    if (pinned.kind === "error") return pinned
    const mismatch = refuseMismatch(pinned)
    if (mismatch !== undefined) return mismatch
    if (pinned.where.kind === "device") return ok(pinned, pinned.all_scope)
  }
  const entries = match === "fuzzy" ? (sources.fuzzyBook?.() ?? sources.book(address)) : sources.book(address)
  // A reply to a sender on this device resolves among this device's entries only, and only by the sender's exact id or
  // stated name: an id prefix never turns an approved reply into a send to another thread.
  let resolved =
    replyTo === undefined
      ? await resolveAddress(context(entries), address, {
          all_scope: scope,
          match,
          ...(request.probe === undefined ? {} : { probe: request.probe }),
          ...(request.id_prefix === undefined ? {} : { id_prefix: request.id_prefix }),
          ...(request.unique_holder === undefined ? {} : { unique_holder: request.unique_holder }),
          ...need,
        })
      : await resolveAddress(context(entries, false), address, { all_scope: scope, id_prefix: false })
  // The reply grant: a consumed delivery's sender on this device is answered without all_scope even when it runs in
  // another workspace. Only a scoped refusal is widened, and the widened hit must still be that sender.
  let widened = replyHere && resolved.kind === "error" && resolved.code === "scope_denied"
  if (widened) resolved = await resolveAddress(context(entries, false), address, { all_scope: true, id_prefix: false })
  // #14048: a sender this device does not hold is looked up account-wide (exact id or name only), and the reply goes only
  // to the session its durable id names, on the one device that lists it.
  if (replyTo !== undefined && resolved.kind === "error" && resolved.code === "not_found") {
    resolved = await resolveAddress(context(entries), address, {
      all_scope: scope,
      match,
      probe: true,
      id_prefix: false,
      unique_holder: true,
    })
    if (resolved.kind === "ok" && resolved.where.kind === "device") {
      if (resolved.thread !== replyTo.session_id) return asRefusal(replyTargetFailure(address, resolved.entry))
      return ok(resolved, resolved.all_scope)
    }
  }
  // A stated name no session carries any more (the sender renamed itself) is answered through the sender's recorded id.
  if (replyHere && resolved.kind === "error" && resolved.code === "not_found" && address !== replyTo.session_id) {
    const byId = await resolveAddress(context(sources.book(replyTo.session_id), false), replyTo.session_id, {
      all_scope: true,
      id_prefix: false,
    })
    if (byId.kind === "ok") {
      resolved = byId
      widened = true
    }
  }
  if (resolved.kind === "error") return resolved
  const mismatch = refuseMismatch(resolved)
  if (mismatch !== undefined) return mismatch
  return ok(
    resolved,
    resolved.where.kind === "device" ? resolved.all_scope : widened ? true : (resolved.all_scope ?? scope),
  )
}

const ok = (resolved: Resolved, allScope: boolean | undefined): ResolveOk => ({
  kind: "ok",
  thread: resolved.address,
  id: resolved.thread,
  device: resolved.device,
  holder: resolved.where,
  leg: resolved.where.kind === "device" ? "relay" : "local",
  all_scope: allScope,
  entry: resolved.entry,
  resolution: resolved.resolution,
})
