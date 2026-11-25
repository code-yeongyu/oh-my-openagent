import { withinCallBudget } from "../call-budget/call-deadline"
import { toThreadAddressEntries } from "./address-book"
import type { ThreadAddressEntry } from "./addressing"
import { accountDevices } from "./address/account"
import type { resolveAddress } from "./address/resolve"
import type { Failed } from "./address/refusals"
import { DEFAULT_THREAD_DELIVERY, type ThreadSendInput, type ThreadHandoffInput } from "./contracts"
import { threadToolFailure, type ThreadToolFailure } from "./errors"
import type { DeliveryPipeline } from "./gateway/pipeline"
import type { DeliveryTarget, DeliveryOutcome } from "./gateway/transport"
import type { DeliveryAuthority, GatewaySender } from "./gateway/types"
import { addressBook, sendBookFor } from "./tools/internals"
import { UNKNOWN_CALLER, type ThreadHostView, type ThreadToolSurfaceOptions } from "./tools/ports"
import { consumedSendersOf } from "./tools/reply-permission"
import { otherDevice, replyTargetFailure, replyTargetMismatch } from "./tools/reply-target"

/** A registered exact id needs no pre-engine view; the engine validates its one endpoint. */
const PUBLISHED_SEND_VIEW: ThreadHostView = { sessions: [], hosts: [], disk: [] }
/** A reply to a sender on another device resolves on that device alone and reads no view of this one. */
const NO_LOCAL_VIEW: ThreadHostView = { sessions: [], hosts: [], disk: [] }

/**
 * This device's id as one send already read it, keyed by the view that send took (#13483 review L1): the choice of view
 * and the route in `locate` rest on the same read, so a read that fails and then succeeds cannot pick an empty view and
 * then route a local reply into it.
 */
const DEVICE_READ = new WeakMap<ThreadHostView, string | undefined | ThreadToolFailure>()

export async function viewForSend(
  options: ThreadToolSurfaceOptions,
  address: string,
  offline: () => Promise<ThreadHostView>,
): Promise<ThreadHostView> {
  if (address !== "self" && (await options.store.sessionOwner(address)) !== null) return PUBLISHED_SEND_VIEW
  const route = await replyRoute(options, address)
  const current = route.leaves ? { ...NO_LOCAL_VIEW } : await offline()
  if (route.read) DEVICE_READ.set(current, route.here)
  return current
}

/**
 * The address resolver a send uses, chosen by its entry: the tools in omo.js load it from the thread client sidecar
 * (`address/lazy.ts`, the entry's byte budget), the standalone thread SDK has it inlined (`address/`), so a send from
 * the SDK needs no plugin import map.
 */
export type SendResolver = typeof resolveAddress

type Principal =
  | { readonly kind: "session"; readonly id: string }
  | { readonly kind: "operator"; readonly uid: number; readonly user: string }

export async function sendThread(
  options: ThreadToolSurfaceOptions,
  pipeline: DeliveryPipeline,
  resolve: SendResolver,
  current: ThreadHostView,
  value: ThreadSendInput | ThreadHandoffInput,
  key: string,
  principal: Principal,
  args: unknown,
  match: "exact" | "fuzzy" = "exact",
) {
  const target = await locate(
    options,
    resolve,
    current,
    value.thread,
    value.all_scope,
    principal.kind === "session" ? principal.id : UNKNOWN_CALLER,
    match,
  )
  if (target.kind === "error") return target
  const sent = await sendToTarget(options, pipeline, target, value, key, principal, args)
  return { kind: "routed" as const, target, sent }
}

export async function sendToTarget(
  options: ThreadToolSurfaceOptions,
  pipeline: DeliveryPipeline,
  target: DeliveryTarget,
  value: ThreadSendInput | ThreadHandoffInput,
  key: string,
  principal: Principal,
  args: unknown,
  authority?: DeliveryAuthority,
): Promise<DeliveryOutcome> {
  if (principal.kind === "session" && principal.id === UNKNOWN_CALLER)
    return {
      kind: "error",
      error: threadToolFailure(
        "caller_context_missing",
        "A gateway send needs the calling session's durable id.",
        "Retry from a session that passes its execution context.",
      ),
    }
  // The operator's local gateway sender is cli; on another device only their own person prompt is admitted.
  const sender: GatewaySender =
    principal.kind === "session"
      ? sessionSender(options, principal.id)
      : { kind: target.kind === "remote" ? "person" : "cli", uid: principal.uid, user: principal.user }
  const inboundHop = principal.kind === "session" ? options.callerChainHop?.() : undefined
  return pipeline.deliver({
    sender,
    caller_id: principal.kind === "session" ? principal.id : `${sender.kind}:${principal.uid}`,
    target,
    text: value.message,
    mode: value.delivery ?? DEFAULT_THREAD_DELIVERY,
    ...(value.expected_turn_id === undefined ? {} : { expected_turn_id: value.expected_turn_id }),
    idempotency_key: key,
    ...("collapse_key" in value && value.collapse_key !== undefined ? { collapse_key: value.collapse_key } : {}),
    args,
    ...(inboundHop === undefined || inboundHop <= 0 ? {} : { inbound_hop: inboundHop }),
    ...(authority === undefined ? {} : { authority }),
  })
}

function sessionSender(options: ThreadToolSurfaceOptions, id: string): GatewaySender {
  const turn = options.callerTurnId?.()
  const cause = options.callerCause?.()
  const name = options.callerName?.()?.trim()
  return {
    kind: "session",
    durable_id: id,
    ...(name === undefined || name === "" ? {} : { name }),
    ...(turn === undefined ? {} : { turn_id: turn }),
    ...(cause === undefined ? {} : { cause_delivery_id: cause }),
  }
}

/**
 * Where a send's address points: a session on another device (its account listing row), or a session this device
 * holds, resolved through the send address book under the scope the address resolved with. A registered exact id
 * (`PUBLISHED_SEND_VIEW`) skips the address book; the engine validates its one endpoint.
 */
async function locate(
  options: ThreadToolSurfaceOptions,
  resolve: SendResolver,
  current: ThreadHostView,
  address: string,
  allScope: boolean | undefined,
  callerId: string,
  match: "exact" | "fuzzy" = "exact",
): Promise<DeliveryTarget | Failed> {
  const scope = allScope
  const refuse = (error: ThreadToolFailure) => ({
    kind: "error" as const,
    error,
  })
  // Amendment A4.3.1 of #13037: a send approved as a reply resolves on the device the consumed delivery came from, before
  // this device's own entries and before any other listing match, whether the sender is named by id or by stated name.
  const senders = match === "exact" ? consumedSendersOf(options, address) : []
  const here =
    match === "exact" && DEVICE_READ.has(current) ? DEVICE_READ.get(current) : await thisDeviceOf(options, senders)
  if (typeof here === "object") return refuse(here)
  const replyTo = replySender(address, senders, here)
  if (replyTo !== undefined && "code" in replyTo) return refuse(replyTo)
  const replyHere = replyTo !== undefined && replyTo.device === undefined
  const localFor = sendBookFor(options, current)
  const context = (local: readonly ThreadAddressEntry[], account = true) => ({
    remote: account ? options.remote : undefined,
    callerWorkspaceRoot: options.callerWorkspaceRoot(),
    local,
    ...(match === "fuzzy" ? {} : { localFor }),
    callerId,
  })
  if (replyTo?.device !== undefined) {
    const resolved = await resolve(context([]), address, {
      pin: { device: replyTo.device, thread: replyTo.session_id },
    })
    if (resolved.kind === "error") return refuse(resolved)
    const mismatch = replyTargetMismatch(options, address, resolved.entry, here)
    if (mismatch !== undefined) return refuse(mismatch)
    if (resolved.where.kind === "device") return { kind: "remote", row: resolved.where.row }
  }
  if (current === PUBLISHED_SEND_VIEW) {
    // A reply approved by the sender's stated name must still land on that sender, not on a published thread that happens to carry the same spelling as its id.
    const mismatch = replyTargetMismatch(
      options,
      address,
      {
        thread_id: address,
        name: address,
        status: "live",
        cwd: "",
        created_at: "",
        updated_at: null,
      },
      here,
    )
    if (mismatch !== undefined) return refuse(mismatch)
    return { kind: "local", thread_id: address, all_scope: replyHere ? true : scope }
  }
  // Decision 0027: ONE resolver over this device's book and the account's other devices (resolveAddress, which takes
  // <device>/<thread> too); where it resolved says which transport carries the send.
  const entries = match === "fuzzy" ? toThreadAddressEntries(addressBook(options, current)) : localFor(address)
  // A reply to a sender on this device resolves among this device's entries only (A4.3.1), and only by the sender's
  // exact id or stated name: an id prefix never turns an approved reply into a send to another thread. A send never
  // targets its own caller, so an id prefix is resolved without it (UUIDv7 ids share 8 hex characters for ~65 s).
  let resolved =
    replyTo === undefined
      ? await resolve(context(entries), address, {
          all_scope: scope,
          match,
          probe: true,
          id_prefix: { exclude: callerId },
        })
      : await resolve(context(entries, false), address, { all_scope: scope, id_prefix: false })
  // The reply grant: a consumed delivery's sender on this device is answered without all_scope even when it runs in
  // another workspace. Only a scoped refusal is widened, and the widened hit must still be that sender
  // (replyTargetMismatch below), so the grant reaches no other session and lasts as long as the reply allowance.
  let widened = replyHere && resolved.kind === "error" && resolved.code === "scope_denied"
  if (widened) resolved = await resolve(context(entries, false), address, { all_scope: true, id_prefix: false })
  // #14048: a delivery id without a device part (`rpc:local/<id>`, a bare row id) proves no device: another device's
  // delivery arrives that way when the connection that admitted it declared no remote origin. A sender this device does
  // not hold is then looked up account-wide (exact id or name only, never an id prefix), and the reply goes only to the
  // session its durable id names, on the one device that lists it: with no device to pin, a copy of that id on a second
  // device makes the sender ambiguous.
  if (replyTo !== undefined && resolved.kind === "error" && resolved.code === "not_found") {
    resolved = await resolve(context(entries), address, {
      all_scope: scope,
      match,
      probe: true,
      id_prefix: false,
      unique_holder: true,
    })
    if (resolved.kind === "ok" && resolved.where.kind === "device") {
      if (resolved.thread !== replyTo.session_id) return refuse(replyTargetFailure(address, resolved.entry))
      return { kind: "remote", row: resolved.where.row }
    }
  }
  // A stated name no session on this device or the account carries any more (the sender renamed itself, or its session
  // file records no name) is answered through the sender's recorded id, so a reply by name reaches it as a reply by id
  // does. A name another session carries, here or on another device, resolved above and is refused there.
  if (replyHere && resolved.kind === "error" && resolved.code === "not_found" && address !== replyTo.session_id) {
    const byId = await resolve(context(localFor(replyTo.session_id), false), replyTo.session_id, {
      all_scope: true,
      id_prefix: false,
    })
    if (byId.kind === "ok") {
      resolved = byId
      widened = true
    }
  }
  if (resolved.kind === "error") return refuse(resolved)
  // The allowance approved this send as a reply to a consumed delivery's sender (by id or stated name): deliver only when
  // the address resolves to that sender on that sender's device, else refuse by name without sending (decision 0027
  // section 6, A4.3.1).
  const mismatch = replyTargetMismatch(options, address, resolved.entry, here)
  if (mismatch !== undefined) return refuse(mismatch)
  if (resolved.where.kind === "device") return { kind: "remote", row: resolved.where.row }
  return { kind: "local", thread_id: resolved.thread, all_scope: widened ? true : (resolved.all_scope ?? scope) }
}

type ConsumedSender = { readonly session_id: string; readonly device?: string }

/**
 * This device's own id, read only when a consumed sender names a device: a sender naming it is a sender on this device.
 * A failed read is a typed host_unavailable, never undefined: without the id a sender on this device cannot be told from
 * one on another device, and guessing "another device" would route a local reply through the relay (#13218 review).
 */
async function thisDeviceOf(
  options: ThreadToolSurfaceOptions,
  senders: readonly ConsumedSender[],
): Promise<string | undefined | ThreadToolFailure> {
  if (options.remote === undefined || !senders.some((sender) => sender.device !== undefined)) return undefined
  const unavailable = (reason: string) =>
    threadToolFailure(
      "host_unavailable",
      "This device's id could not be read, so a reply to a sender named by its device cannot be routed; nothing was sent.",
      "Retry when the device service is reachable.",
      {
        devices: [...new Set(senders.flatMap((sender) => (sender.device === undefined ? [] : [sender.device])))],
        reason,
      },
    )
  try {
    // #14226: the read is cut by what is left of the call's budget, not only by the device client's own deadline.
    const listed = await withinCallBudget(accountDevices(options.remote.client))
    if (listed === undefined) return unavailable("request_timeout")
    return listed.here ?? undefined
  } catch (error) {
    return unavailable(error instanceof Error ? error.message : String(error))
  }
}

/**
 * Whether `address` is an approved reply to a consumed sender on another device, or names such senders ambiguously
 * (`leaves`), with this device's id as read for that decision (`here`, when `read`), which `locate` reuses.
 */
async function replyRoute(
  options: ThreadToolSurfaceOptions,
  address: string,
): Promise<{
  readonly leaves: boolean
  readonly read: boolean
  readonly here?: string | undefined | ThreadToolFailure
}> {
  const senders = consumedSendersOf(options, address)
  if (!senders.some((sender) => sender.device !== undefined)) return { leaves: false, read: false }
  const here = await thisDeviceOf(options, senders)
  // An unreadable device id takes no local listing either: the send answers that failure (sendTarget) before any route.
  if (typeof here === "object") return { leaves: true, read: true, here }
  const replyTo = replySender(address, senders, here)
  return { leaves: replyTo !== undefined && ("code" in replyTo || replyTo.device !== undefined), read: true, here }
}

/**
 * The one consumed sender a reply addresses, its device absent for this device; undefined when the send is no reply. One
 * session id stated from two devices, or one name stated by two senders, is ambiguous_target: none is picked.
 */
function replySender(
  address: string,
  senders: readonly ConsumedSender[],
  here: string | undefined,
): { readonly session_id: string; readonly device: string | undefined } | ThreadToolFailure | undefined {
  const distinct = new Map<string, { readonly session_id: string; readonly device: string | undefined }>()
  for (const sender of senders) {
    const device = otherDevice(sender.device, here)
    distinct.set(JSON.stringify([sender.session_id, device ?? null]), { session_id: sender.session_id, device })
  }
  const found = [...distinct.values()]
  if (found.length <= 1) return found[0]
  return threadToolFailure(
    "ambiguous_target",
    `"${address}" names more than one sender of this run's deliveries; none was picked.`,
    "Send to the intended thread as a normal send, by its id.",
    {
      candidates: found.map((sender) => ({
        thread: sender.session_id,
        ...(sender.device === undefined ? {} : { device: sender.device }),
      })),
    },
  )
}
