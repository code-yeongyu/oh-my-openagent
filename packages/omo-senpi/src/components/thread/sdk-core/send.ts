import { randomUUID } from "node:crypto"

import { resolveAddress } from "../address"
import { toThreadAddressEntries } from "../address-book"
import { DEFAULT_THREAD_DELIVERY, type ThreadSendResult } from "../contracts"
import type { DeliveryTarget } from "../gateway/transport"
import type { GatewayDeliveryMode, GatewayDeliverySuccess } from "../gateway/types"
import { hostView, sendAddressBook } from "../tools/internals"
import type { ThreadHostView } from "../tools/ports"
import { sentThreadLink } from "../tools/send-link"
import type { ThreadCoreContext } from "./context"
import { type Failure, fail, guarded } from "./failures"
import { unknownKeys } from "../contracts"

export type CoreSendRequest = {
  readonly thread: string
  readonly message: string
  readonly delivery?: GatewayDeliveryMode
  /** The facade passes a number, the tool schema a string; the delivery records it as written. */
  readonly expected_turn_id?: number | string
  readonly all_scope?: boolean
  readonly idempotency_key?: string
  /** Replaces this sender's earlier undelivered send to the thread under the same key (#14428). */
  readonly collapse_key?: string
}

/**
 * The tool's send answer (thread/contracts/results.ts) plus `endpoint_kind`, the kind of endpoint the delivery was
 * queued for on this device (`omo thread send --json` prints it); absent when another device took the delivery.
 */
export type CoreSendResult =
  | (Extract<ThreadSendResult, { readonly kind: "ok" }> & {
      readonly endpoint_kind?: GatewayDeliverySuccess["endpoint_kind"]
    })
  | Failure

export const SEND_KEYS = [
  "thread",
  "message",
  "delivery",
  "expected_turn_id",
  "all_scope",
  "idempotency_key",
  "collapse_key",
] as const

const HERE_PREFIX = "here/"

/** The thread part of a `here/<thread>` address, for building the local book: a session file answers a bare id. */
const bareOf = (address: string): string =>
  address.startsWith(HERE_PREFIX) ? address.slice(HERE_PREFIX.length) : address

export function createSend(context: ThreadCoreContext) {
  const { options, principal, store, surface, pipeline, resolveContext } = context
  return (request: CoreSendRequest): Promise<CoreSendResult> =>
    guarded(async () => {
      const refused = unknownKeys(request, SEND_KEYS)
      if (refused !== undefined) return refused
      // The same road as an agent's send: the address resolves through the address module (across the account when this SDK
      // has one, this device only otherwise), and the target's kind picks the transport. Like the agent's thread_send, an id
      // this device's gateway owns needs no lookup (no host listing, no account call); any other address resolves over the
      // offline view and the send address book, so a thread that is not running with nothing live answering still queues offline.
      let target: DeliveryTarget = {
        kind: "local",
        thread_id: request.thread,
        ...(request.all_scope === undefined ? {} : { all_scope: request.all_scope }),
      }
      let routedWith: ThreadHostView | undefined
      if ((await store.sessionOwner(request.thread)) === null) {
        const offline = await hostView(surface, { offline: true })
        routedWith = offline
        const across = await resolveAddress(
          resolveContext(toThreadAddressEntries(sendAddressBook(surface, offline, bareOf(request.thread), true))),
          request.thread,
          { all_scope: request.all_scope },
        )
        if (across.kind === "error")
          return fail(
            across.code,
            across.message,
            across.next_action,
            "details" in across ? (across as { details?: Readonly<Record<string, unknown>> }).details : undefined,
          )
        target =
          across.where.kind === "device"
            ? { kind: "remote", row: across.where.row }
            : {
                kind: "local",
                thread_id: across.thread,
                ...(across.all_scope === undefined ? {} : { all_scope: across.all_scope }),
              }
      }
      // The engine admits a command-line delivery only from its own machine, so a send to another device goes the way
      // `omo remote send` does: this person's own input, a prompt keyed by the person principal (#14616). The process runs
      // as that same user with the same device service, so it reaches nothing that command could not.
      const remote = target.kind === "remote"
      // The relay leg keys its idempotency receipt on these args; they keep the names the shipped SDK stored (text, mode),
      // so a retry under the same key replays across an upgrade or a rollback instead of answering idempotency_conflict.
      const { message, delivery, ...rest } = request
      const sent = await pipeline.deliver({
        sender: { kind: remote ? "person" : "cli", uid: options.uid, user: options.user },
        caller_id: remote ? `person:${options.uid}` : principal,
        target,
        text: request.message,
        mode: request.delivery ?? DEFAULT_THREAD_DELIVERY,
        ...(request.expected_turn_id === undefined ? {} : { expected_turn_id: String(request.expected_turn_id) }),
        idempotency_key: request.idempotency_key ?? `auto:${randomUUID()}`,
        ...(request.collapse_key === undefined ? {} : { collapse_key: request.collapse_key }),
        args: { ...rest, text: message, ...(delivery === undefined ? {} : { mode: delivery }) },
      })
      if (sent.kind !== "ok") return sent
      const { thread_id, ...facts } = sent
      return {
        ...facts,
        thread: thread_id,
        link: sentThreadLink(thread_id, routedWith, target),
      } as Extract<CoreSendResult, { readonly kind: "ok" }>
    })
}
