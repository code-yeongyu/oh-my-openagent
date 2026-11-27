import { toThreadAddressEntries } from "./address-book"
import type { resolve as Resolve } from "./address/contract"
import type { ResolvePrincipal } from "./address/principal"
import { replySender, replyTargetMismatch, thisDeviceOf } from "./address/reply"
import type { Failed } from "./address/refusals"
import { DEFAULT_THREAD_DELIVERY, type ThreadSendInput, type ThreadHandoffInput } from "./contracts"
import { threadToolFailure, type ThreadToolFailure } from "./errors"
import type { DeliveryPipeline } from "./gateway/pipeline"
import type { DeliveryTarget, DeliveryOutcome } from "./gateway/transport"
import { REFUSAL_CODES } from "./gateway/result"
import { senderClass, type DeliveryAuthority, type GatewaySender } from "./gateway/types"
import { keyedMessageId } from "./remote/client-message-id"
import { held } from "./remote/held-answers"
import { addressBook, hostView, sendBookFor } from "./tools/internals"
import { UNKNOWN_CALLER, type ThreadHostView, type ThreadToolSurfaceOptions } from "./tools/ports"
import { consumedSendersOf } from "./tools/reply-permission"

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
 * The resolve a send uses, chosen by its entry: the tools in omo.js load it from the thread client sidecar
 * (`address/lazy.ts`, the entry's byte budget), the standalone thread SDK has it inlined (`address/`), so a send from
 * the SDK needs no plugin import map.
 */
export type SendResolver = typeof Resolve

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
  const target = await locate(options, resolve, current, value.thread, value.all_scope, principal, match)
  if (target.kind === "error") return target
  const turned = await steerTurn(options, current, target, value, principal)
  if (turned.kind === "error") return turned
  const sent = await sendToTarget(options, pipeline, target, turned.value, key, principal, args)
  return { kind: "routed" as const, target, sent }
}

/**
 * The steer rule by principal (design ruling of record on #14943, #15007): a session names the turn it steers (its
 * transport refuses a steer without one); a person or script may omit it, and the running turn is read and steered,
 * on every leg. Another device's transport reads it there; a session here is read here, through its endpoint.
 */
async function steerTurn(
  options: ThreadToolSurfaceOptions,
  current: ThreadHostView,
  target: DeliveryTarget,
  value: ThreadSendInput | ThreadHandoffInput,
  principal: Principal,
): Promise<{ readonly kind: "ok"; readonly value: ThreadSendInput | ThreadHandoffInput } | Failed> {
  const unnamed =
    principal.kind === "operator" &&
    target.kind === "local" &&
    (value.delivery ?? DEFAULT_THREAD_DELIVERY) === "steer" &&
    value.expected_turn_id === undefined
  // Held (held-answers.ts send-steer-fill-local): dev refuses this steer (the gateway asks for expected_turn_id) until
  // slice T1b clears threads.send.
  if (!unnamed || held("send-steer-fill-local")) return { kind: "ok", value }
  const book =
    current === PUBLISHED_SEND_VIEW ? addressBook(options, await hostView(options)) : addressBook(options, current)
  const routing = book.find((entry) => entry.durable_id === target.thread_id)?.endpoint?.routing_id ?? null
  const state = routing === null ? undefined : await options.host.getState(routing, target.thread_id)
  const turn = state?.isStreaming === true ? state.activeTurnId : undefined
  if (turn === undefined)
    return {
      kind: "error",
      error: threadToolFailure(
        REFUSAL_CODES.not_steerable.code,
        `A steer to ${target.thread_id} was refused: not_steerable.`,
        REFUSAL_CODES.not_steerable.next,
      ),
    }
  return { kind: "ok", value: { ...value, expected_turn_id: turn } }
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
    // A person's prompt to another device is named by a client message id, the delivery_id its answer carries. It is
    // derived from the caller and the key (#15011), as the remote module's own sends derive it, so a repeat under the key
    // from any process carries the id the holder admitted once (senpi admits one prompt per client message id).
    // Held (held-answers.ts sdk-send-delivery-id): no id, so no delivery_id in the answer, as dev answers it, until T1b.
    ...(!held("sdk-send-delivery-id") && sender.kind === "person" && target.kind === "remote"
      ? {
          client_message_id: keyedMessageId(
            { device: target.row.device, session: target.row.session_id, durable: target.row.durable_id },
            senderClass(sender),
            key,
          ),
        }
      : {}),
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
 * Where a send's address points, through the one resolve (design section 5) with the send's own inputs: a session's send
 * excludes its caller from an id prefix and passes the senders its reply allowance approved; a script's sets neither. A
 * registered exact id (`PUBLISHED_SEND_VIEW`) skips the address book; the engine validates its one endpoint.
 */
async function locate(
  options: ThreadToolSurfaceOptions,
  resolve: SendResolver,
  current: ThreadHostView,
  address: string,
  allScope: boolean | undefined,
  principal: Principal,
  match: "exact" | "fuzzy",
): Promise<DeliveryTarget | Failed> {
  const refuse = (error: ThreadToolFailure) => ({ kind: "error" as const, error })
  const senders = match === "exact" ? consumedSendersOf(options, address) : []
  const here =
    match === "exact" && DEVICE_READ.has(current)
      ? DEVICE_READ.get(current)
      : await thisDeviceOf(options.remote, senders)
  if (typeof here === "object") return refuse(here)
  const replyTo = replySender(address, senders, here)
  if (replyTo !== undefined && "code" in replyTo) return refuse(replyTo)
  if (current === PUBLISHED_SEND_VIEW && replyTo?.device === undefined) {
    // A reply approved by the sender's stated name must still land on that sender, not on a published thread that happens to carry the same spelling as its id.
    const mismatch = replyTargetMismatch(
      senders,
      address,
      { thread_id: address, name: address, status: "live", cwd: "", created_at: "", updated_at: null },
      here,
    )
    if (mismatch !== undefined) return refuse(mismatch)
    return { kind: "local", thread_id: address, all_scope: replyTo !== undefined ? true : allScope }
  }
  const callerId = principal.kind === "session" ? principal.id : UNKNOWN_CALLER
  const resolvePrincipal: ResolvePrincipal = principal.kind === "session" ? principal : { kind: "script" }
  const resolved = await resolve(
    {
      remote: options.remote,
      workspace: options.callerWorkspaceRoot(),
      book: sendBookFor(options, current),
      fuzzyBook: () => toThreadAddressEntries(addressBook(options, current)),
    },
    address,
    {
      operation: "deliver",
      principal: resolvePrincipal,
      scope: { all_scope: allScope },
      match,
      reply: senders,
      here,
      probe: true,
      id_prefix: { exclude: callerId },
    },
  )
  if (resolved.kind === "error") return refuse(resolved)
  if (resolved.holder.kind === "device") return { kind: "remote", row: resolved.holder.row }
  return { kind: "local", thread_id: resolved.id, all_scope: resolved.all_scope }
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
  const here = await thisDeviceOf(options.remote, senders)
  // An unreadable device id takes no local listing either: the send answers that failure (sendTarget) before any route.
  if (typeof here === "object") return { leaves: true, read: true, here }
  const replyTo = replySender(address, senders, here)
  return { leaves: replyTo !== undefined && ("code" in replyTo || replyTo.device !== undefined), read: true, here }
}
