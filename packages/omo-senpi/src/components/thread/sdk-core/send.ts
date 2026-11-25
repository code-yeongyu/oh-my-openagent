import { randomUUID } from "node:crypto"

import { resolveAddress } from "../address"
import type { ThreadSendResult } from "../contracts"
import type { GatewayDeliveryMode, GatewayDeliverySuccess } from "../gateway/types"
import { sendThread, viewForSend } from "../sdk-send"
import { hostView } from "../tools/internals"
import { sentThreadLink } from "../tools/send-link"
import type { ThreadCoreContext } from "./context"
import { type Failure } from "./failures"
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

const SEND_KEYS = [
  "thread",
  "message",
  "delivery",
  "expected_turn_id",
  "all_scope",
  "idempotency_key",
  "collapse_key",
] as const

export function createSend(context: ThreadCoreContext) {
  const { options, surface, pipeline, controls } = context
  return (request: CoreSendRequest): Promise<CoreSendResult> =>
    context.guard(async () => {
      const refused = unknownKeys(request, SEND_KEYS)
      if (refused !== undefined) return refused
      // The agent's send operation (sdk-send.ts): one locate, the stale-route recovery and the sender a principal takes. A
      // script sends as cli here and as the person's prompt to another device, because the engine admits a command-line
      // delivery only from its own machine (#14616); the process runs as that same user, so it reaches nothing more.
      const current = await viewForSend(controls, request.thread, () => hostView(surface, { offline: true }))
      // The relay leg keys its idempotency receipt on these args; they keep the names the shipped SDK stored (text, mode),
      // so a retry under the same key replays across an upgrade or a rollback instead of answering idempotency_conflict.
      const { message, delivery, ...rest } = request
      const routed = await sendThread(
        controls,
        pipeline,
        resolveAddress,
        current,
        {
          thread: request.thread,
          message,
          delivery,
          all_scope: request.all_scope,
          expected_turn_id: request.expected_turn_id === undefined ? undefined : String(request.expected_turn_id),
          collapse_key: request.collapse_key,
        },
        request.idempotency_key ?? `auto:${randomUUID()}`,
        { kind: "operator", uid: options.uid, user: options.user },
        { ...rest, text: message, ...(delivery === undefined ? {} : { mode: delivery }) },
      )
      if (routed.kind === "error") return routed
      const sent = routed.sent
      if (sent.kind !== "ok") return sent
      const { thread_id, ...facts } = sent
      return {
        ...facts,
        thread: thread_id,
        link: sentThreadLink(thread_id, current, routed.target),
      } as Extract<CoreSendResult, { readonly kind: "ok" }>
    })
}
