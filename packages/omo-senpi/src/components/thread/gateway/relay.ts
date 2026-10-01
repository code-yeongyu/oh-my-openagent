/**
 * The relay SDK: bindings, the outbox, reply tokens and connector inbound, over one gateway store.
 * The agent tools (`thread_bind` ... `thread_answer`) call it with the calling session's principal;
 * the `omo thread` CLI (todo 14) calls the same functions with `cli:<uid>`, and a connector drives
 * only `outbox`, `ack`, `answer` and `inbound`. Every result is data: `{ kind: "ok", ... }` or
 * `{ kind: "error", error }` with a taxonomy code and a `next_action`.
 */
import { threadToolFailure, type ThreadErrorCode, type ThreadToolFailure } from "../errors"
import type { GatewayEndpointPort, GatewayEndpointRef, UiAnswerReply } from "./adapter"
import { answerShape, type UiRequestKind } from "./answer-shape"
import { type BindInput, type BindingRecord, type CompletionOutcome, hashArgs, INBOUND_MODES, type InboundMode, normalizeBindInput, type OutboundEvent, RELAY_TEXT_MAX_BYTES, type RelayOutcome } from "./bindings"
import type { GatewayEngine } from "./engine"
import { isLockWaitExceeded, retryAfterLockWait } from "./lock-wait"
import type { GatewayStore, OutboxPage } from "./store"
import { CLOSED_ELSEWHERE, type AnswerClaimRef, type AnswerDelivered, type BindingsFilter, type ReportOpResult } from "./store-relay-ops"
import { normalizeAuthor } from "./author"
import type { ExternalAuthor, GatewayDeliveryResult, StoreRefusal } from "./types"

export type RelayResult<T> = ({ readonly kind: "ok" } & T) | { readonly kind: "error"; readonly error: ThreadToolFailure }

type Keyed = { readonly principal: string; readonly idempotency_key?: string }

export type GatewayRelay = {
  readonly bind: (request: Keyed & { readonly binding: BindInput }) => Promise<RelayResult<{ readonly binding: BindingRecord; readonly deduplicated: boolean }>>
  readonly unbind: (request: Keyed & { readonly binding_id: string; readonly expected_revision: number }) => Promise<RelayResult<{ readonly binding: BindingRecord; readonly already_closed: boolean; readonly in_flight: readonly string[]; readonly deduplicated: boolean }>>
  readonly rebind: (request: Keyed & { readonly binding_id: string; readonly expected_revision: number; readonly session_durable_id: string }) => Promise<RelayResult<{ readonly binding: BindingRecord; readonly closed: readonly string[]; readonly deduplicated: boolean }>>
  readonly bindings: (request: { readonly filter: BindingsFilter; readonly cursor?: string; readonly limit?: number }) => Promise<RelayResult<{ readonly bindings: readonly BindingRecord[]; readonly next_cursor: string | null }>>
  readonly report: (request: Keyed & { readonly session_durable_id: string; readonly binding_id?: string; readonly origin_delivery_id?: string; readonly event: OutboundEvent; readonly text: string; readonly request_id?: string; readonly request_kind?: UiRequestKind }) => Promise<RelayResult<ReportOpResult & { readonly deduplicated: boolean }>>
  readonly outbox: (request: { readonly binding_id: string; readonly after_cursor?: number; readonly limit?: number }) => Promise<RelayResult<OutboxPage>>
  readonly ack: (request: { readonly binding_id: string; readonly cursor: number; readonly provider_message_id?: string }) => Promise<RelayResult<{ readonly binding_id: string; readonly acked_cursor: number; readonly changed: boolean }>>
  /**
   * `binding_id` is the binding the answer arrived THROUGH (the connector's authenticated context), never read from the token.
   * `author` is the human who answered, recorded on the question's outbox row as `answered_by`.
   */
  readonly answer: (request: { readonly binding_id: string; readonly reply_token: string; readonly answer: string; readonly author?: ExternalAuthor }) => Promise<RelayResult<{ readonly binding_id: string; readonly cursor: number; readonly session_durable_id: string; readonly answered_by: ExternalAuthor | null }>>
  /**
   * A connector's inbound message; one `event_id` is admitted once. `author` is the human who wrote it,
   * rendered in the provenance header outside the body. `mode` defaults to the binding's `inbound_mode`
   * and may never exceed it: `follow_up` is allowed on an `auto` binding, `auto` on a `follow_up` binding
   * is `invalid_arguments`, and `steer` is refused on every binding.
   */
  readonly inbound: (request: { readonly binding_id: string; readonly event_id: string; readonly text: string; readonly author?: ExternalAuthor; readonly mode?: InboundMode }) => Promise<GatewayDeliveryResult>
  /** The session settled: armed completions become outbox rows with this outcome. */
  readonly settle: (request: { readonly session_durable_id: string; readonly outcome: CompletionOutcome }) => Promise<readonly { readonly binding_id: string; readonly cursor: number }[]>
  /** Shutdown: cancels background answer-release retries. */
  readonly dispose: () => void
}

export type GatewayRelayOptions = {
  readonly store: GatewayStore
  readonly engine: GatewayEngine
  readonly endpoints: GatewayEndpointPort
  /** The endpoint serving a session right now, or null when nothing answers for it. */
  readonly locate: (durableId: string) => Promise<GatewayEndpointRef | null>
  readonly now?: () => number
}

const NEXT_ACTION: Partial<Record<ThreadErrorCode, string>> = {
  binding_conflict: "Call thread_bindings to find the binding that holds this thread, then thread_rebind it with its revision, or thread_unbind it first.",
  binding_mismatch: "Answer through the binding that asked the question; the question stays pending.",
  binding_inactive: "Bind the thread again with thread_bind.",
  stale_revision: "Call thread_bindings for the current revision and retry with it.",
  stale_token: "The question was asked under an earlier binding revision or session runtime; wait for the session to ask again.",
  already_answered: "Nothing to do: the question has its answer.",
  answer_in_progress: "Retry after a moment: another answer is still being handed to the session, and the question goes back to pending if that fails.",
  idempotency_conflict: "Retry with a new idempotency_key.",
  idempotency_uncertain: "Call thread_bindings or thread_outbox to see the current state before retrying with a new key.",
  scope_denied: "Report through a binding attached to this session; thread_bindings lists them.",
  unsupported: "Report only the events the binding subscribes to, through a binding with an outbound direction.",
  not_found: "Call thread_bindings for the binding ids that exist.",
  cursor_invalid: "Read thread_outbox again and ack a cursor it returned.",
  host_unavailable: "Retry when the session is running; the question stays pending.",
  invalid_arguments: "Fix the arguments and call again.",
}

/** Endpoint refusals meaning the session no longer waits on the request (senpi host dialog/question, terminal). */
const SESSION_NO_LONGER_WAITS: ReadonlySet<string> = new Set(["question_already_resolved", "unknown_extension_ui_request", "unknown_request"])

function failure(code: ThreadErrorCode, message: string, details?: Readonly<Record<string, unknown>>, nextAction?: string): { readonly kind: "error"; readonly error: ThreadToolFailure } {
  return { kind: "error", error: threadToolFailure(code, message, nextAction ?? NEXT_ACTION[code] ?? "Call thread_bindings and retry after checking the binding.", details) }
}

function fromStore<T extends object>(outcome: RelayOutcome<T> | StoreRefusal): RelayResult<T> {
  if (outcome.kind === "refused") return failure(outcome.code, outcome.message, outcome.details)
  return outcome as RelayResult<T>
}

function checkedAuthor(author: ExternalAuthor | undefined): ExternalAuthor | undefined | { readonly kind: "error"; readonly error: ThreadToolFailure } {
  if (author === undefined) return undefined
  const normalized = normalizeAuthor(author)
  return "kind" in normalized ? failure("invalid_arguments", normalized.message) : normalized
}

function textTooLarge(text: string): { readonly kind: "error"; readonly error: ThreadToolFailure } | undefined {
  const bytes = Buffer.byteLength(text)
  return bytes > RELAY_TEXT_MAX_BYTES ? failure("message_too_large", `The text is ${bytes} bytes, above the ${RELAY_TEXT_MAX_BYTES}-byte limit.`) : undefined
}

function receipt(request: Keyed, operation: string, args: unknown) {
  return request.idempotency_key === undefined ? null : { principal: request.principal, operation, idempotency_key: request.idempotency_key, args_hash: hashArgs(args) }
}

export function createGatewayRelay(options: GatewayRelayOptions): GatewayRelay {
  const store = options.store
  const now = options.now ?? store.now

  // A claimed answer whose hand-off failed goes back to pending; one that reached the session is
  // confirmed, so a later answer reads `already_answered` instead of `answer_in_progress`. A release
  // or confirmation that gives up at the store's lock-wait bound is retried in the background after
  // the busy timeout until it lands, so the question never stays `answered` without having reached
  // the session. A release undoes only this caller's own in-flight claim: once another answer took it
  // over, or the question was delivered, a late release changes nothing. A confirmation records that
  // the session took THIS answer, so it lands even when another answer took the claim over meanwhile.
  const retries = new Set<{ readonly cancel: () => void }>()
  let disposed = false
  async function release(claim: AnswerClaimRef): Promise<void> {
    await settleClaim(() => store.releaseAnswer(claim))
  }
  async function confirm(delivered: AnswerDelivered): Promise<void> {
    await settleClaim(() => store.confirmAnswer(delivered))
  }
  async function settleClaim(attempt: () => Promise<boolean>): Promise<void> {
    try {
      await attempt()
    } catch (error) {
      if (!isLockWaitExceeded(error) || disposed) throw error
      const retry = retryAfterLockWait(
        () => attempt().then(() => { retries.delete(retry) }),
        () => store.busyTimeoutMs,
        () => { retries.delete(retry) },
      )
      retries.add(retry)
    }
  }

  return {
    bind: async (request) => {
      const binding = normalizeBindInput(request.binding)
      if ("kind" in binding) return fromStore(binding)
      return fromStore(await store.bind({ now: now(), receipt: receipt(request, "thread_bind", binding), binding })) as RelayResult<{ binding: BindingRecord; deduplicated: boolean }>
    },
    unbind: async (request) => {
      const args = { binding_id: request.binding_id, expected_revision: request.expected_revision }
      return fromStore(await store.unbind({ now: now(), receipt: receipt(request, "thread_unbind", args), ...args })) as RelayResult<{ binding: BindingRecord; already_closed: boolean; in_flight: readonly string[]; deduplicated: boolean }>
    },
    rebind: async (request) => {
      const args = { binding_id: request.binding_id, expected_revision: request.expected_revision, session_durable_id: request.session_durable_id }
      return fromStore(await store.rebind({ now: now(), receipt: receipt(request, "thread_rebind", args), ...args })) as RelayResult<{ binding: BindingRecord; closed: readonly string[]; deduplicated: boolean }>
    },
    bindings: async (request) => fromStore(await store.listBindings({ now: now(), ...request })),
    report: async (request) => {
      const tooLarge = textTooLarge(request.text)
      if (tooLarge !== undefined) return tooLarge
      const args = { session_durable_id: request.session_durable_id, binding_id: request.binding_id ?? null, origin_delivery_id: request.origin_delivery_id ?? null, event: request.event, text: request.text, ui_request_id: request.request_id ?? null, ui_request_kind: request.request_kind ?? null }
      return fromStore(await store.report({ now: now(), receipt: receipt(request, "thread_report", args), ...args })) as RelayResult<ReportOpResult & { deduplicated: boolean }>
    },
    outbox: async (request) => fromStore(await store.readOutbox({ now: now(), ...request })),
    ack: async (request) => fromStore(await store.ackOutbox({ now: now(), ...request })),
    answer: async (request) => {
      const tooLarge = textTooLarge(request.answer)
      if (tooLarge !== undefined) return tooLarge
      const author = checkedAuthor(request.author)
      if (author !== undefined && "kind" in author) return author
      const answeredBy = author ?? null
      const claim = await store.claimAnswer({ now: now(), binding_id: request.binding_id, reply_token: request.reply_token, answer: request.answer, answered_by: answeredBy })
      if (claim.kind !== "ok") return fromStore(claim)
      const own: AnswerClaimRef = { reply_token: request.reply_token, claimed_at: claim.claimed_at }
      const respond = options.endpoints.respondUi
      let endpoint: GatewayEndpointRef | null = null
      let unreachable = ""
      if (respond !== undefined) {
        try {
          endpoint = await options.locate(claim.session_durable_id)
        } catch (error) {
          unreachable = `: ${error instanceof Error ? error.message : String(error)}`
        }
      }
      if (respond === undefined || endpoint === null) {
        await release(own)
        return failure(respond === undefined ? "unsupported" : "host_unavailable", `The session that asked is not reachable to take the answer${unreachable}.`, { session: claim.session_durable_id })
      }
      const shape = answerShape(claim.ui_request_kind, request.answer)
      if (!shape.ok) {
        await release(own)
        return failure("invalid_arguments", shape.reason, { session: claim.session_durable_id, ui_request_kind: claim.ui_request_kind })
      }
      let reply: UiAnswerReply
      try {
        reply = await respond(endpoint, { ui_request_id: claim.ui_request_id, fields: shape.fields })
      } catch (error) {
        await release(own)
        return failure("host_unavailable", `The answer could not be handed to the session: ${error instanceof Error ? error.message : String(error)}`, { session: claim.session_durable_id })
      }
      if (!reply.delivered) {
        // The session answered and refused: it no longer waits on that request, or cannot read the answer.
        // An answer that took over an expired claim and hears "no longer waits" is not pending again.
        // Only question_already_resolved says the session took an answer, the expired claim's; the
        // unknown_* codes also mean it was closed another way (answered locally, timed out, cancelled),
        // so the question is delivered with no answer text rather than the dead claimant's.
        const priorAnswer = claim.taken_over
        if (priorAnswer !== null && SESSION_NO_LONGER_WAITS.has(reply.error)) {
          if (reply.error === "question_already_resolved") {
            await settleClaim(() => store.markPriorDelivered({ ...own, prior: priorAnswer }))
            return failure("already_answered", `The session already took an earlier answer to this question (${reply.error}).`, { session: claim.session_durable_id, reason: reply.error })
          }
          await settleClaim(() => store.markPriorDelivered({ ...own, prior: { answer: null, answered_at: own.claimed_at } }))
          return failure("already_answered", `${CLOSED_ELSEWHERE} (${reply.error}).`, { session: claim.session_durable_id, reason: reply.error }, "Nothing to do: the session no longer waits for this question.")
        }
        await release(own)
        const malformed = reply.error === "invalid_response" || reply.error === "question_incomplete"
        return failure(
          malformed ? "invalid_arguments" : "stale_token",
          `The session refused the answer: ${reply.error}`,
          { session: claim.session_durable_id, reason: reply.error },
          malformed
            ? `The session could not read this answer (${reply.error}); answer again with text it can take. The question stays pending.`
            : `The session refused the answer (${reply.error}): it no longer waits on this question. Read thread_outbox for a newer question and answer that one.`,
        )
      }
      await confirm({ ...own, answer: request.answer, answered_by: answeredBy })
      return { kind: "ok", binding_id: request.binding_id, cursor: claim.cursor, session_durable_id: claim.session_durable_id, answered_by: answeredBy }
    },
    inbound: async (request) => {
      if (request.mode !== undefined && !(INBOUND_MODES as readonly string[]).includes(request.mode)) {
        return failure("invalid_arguments", `A binding message is delivered as ${INBOUND_MODES.join(" or ")}, never ${String(request.mode)}.`, { mode: request.mode }, "Send with mode auto or follow_up, or omit it for the binding's inbound_mode.")
      }
      const author = checkedAuthor(request.author)
      if (author !== undefined && "kind" in author) return author
      const binding = await store.bindingView({ now: now(), binding_id: request.binding_id })
      if (binding === null) return failure("not_found", "No binding has this id.", { binding_id: request.binding_id })
      if (binding.status !== "active") return failure("binding_inactive", `The binding is ${binding.status}.`, { binding_id: binding.binding_id, status: binding.status })
      if (!binding.direction.inbound) return failure("unsupported", "The binding carries no inbound direction.", { binding_id: binding.binding_id })
      const mode = request.mode ?? binding.inbound_mode
      if (mode === "auto" && binding.inbound_mode === "follow_up") {
        return failure("invalid_arguments", "The binding delivers at most follow_up; a message cannot ask for more than its binding's inbound_mode.", { binding_id: binding.binding_id, mode, inbound_mode: binding.inbound_mode }, "Send with mode follow_up (or omit it), or rebind the thread with inbound_mode auto.")
      }
      return await options.engine.deliver({
        sender: {
          kind: "external",
          origin: { platform: binding.platform, account_id: binding.account_id, chat_id: binding.chat_id, thread_id: binding.thread_id, message_id: request.event_id, ...(author === undefined ? {} : { author }) },
          binding_id: binding.binding_id,
          binding_revision: binding.revision,
        },
        target: binding.session_durable_id,
        text: request.text,
        mode,
        all_scope: true,
        idempotency_key: `event:${request.event_id}`,
      })
    },
    settle: (request) => store.emitCompletions({ now: now(), ...request }),
    dispose: () => {
      disposed = true
      for (const retry of retries) retry.cancel()
      retries.clear()
    },
  }
}
