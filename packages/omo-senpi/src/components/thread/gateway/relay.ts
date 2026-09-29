/**
 * The relay SDK: bindings, the outbox, reply tokens and connector inbound, over one gateway store.
 * The agent tools (`thread_bind` ... `thread_answer`) call it with the calling session's principal;
 * the `omo thread` CLI (todo 14) calls the same functions with `cli:<uid>`, and a connector drives
 * only `outbox`, `ack`, `answer` and `inbound`. Every result is data: `{ kind: "ok", ... }` or
 * `{ kind: "error", error }` with a taxonomy code and a `next_action`.
 */
import { threadToolFailure, type ThreadErrorCode, type ThreadToolFailure } from "../errors"
import type { GatewayEndpointPort, GatewayEndpointRef } from "./adapter"
import { type BindInput, type BindingRecord, type CompletionOutcome, hashArgs, normalizeBindInput, type OutboundEvent, RELAY_TEXT_MAX_BYTES, type RelayOutcome } from "./bindings"
import type { GatewayEngine } from "./engine"
import type { GatewayStore, OutboxPage } from "./store"
import type { BindingsFilter, ReportOpResult } from "./store-relay-ops"
import type { GatewayDeliveryResult, StoreRefusal } from "./types"

export type RelayResult<T> = ({ readonly kind: "ok" } & T) | { readonly kind: "error"; readonly error: ThreadToolFailure }

type Keyed = { readonly principal: string; readonly idempotency_key?: string }

export type GatewayRelay = {
  readonly bind: (request: Keyed & { readonly binding: BindInput }) => Promise<RelayResult<{ readonly binding: BindingRecord; readonly deduplicated: boolean }>>
  readonly unbind: (request: Keyed & { readonly binding_id: string; readonly expected_revision: number }) => Promise<RelayResult<{ readonly binding: BindingRecord; readonly already_closed: boolean; readonly in_flight: readonly string[]; readonly deduplicated: boolean }>>
  readonly rebind: (request: Keyed & { readonly binding_id: string; readonly expected_revision: number; readonly session_durable_id: string }) => Promise<RelayResult<{ readonly binding: BindingRecord; readonly closed: readonly string[]; readonly deduplicated: boolean }>>
  readonly bindings: (request: { readonly filter: BindingsFilter; readonly cursor?: string; readonly limit?: number }) => Promise<RelayResult<{ readonly bindings: readonly BindingRecord[]; readonly next_cursor: string | null }>>
  readonly report: (request: Keyed & { readonly session_durable_id: string; readonly binding_id?: string; readonly event: OutboundEvent; readonly text: string; readonly request_id?: string }) => Promise<RelayResult<ReportOpResult & { readonly deduplicated: boolean }>>
  readonly outbox: (request: { readonly binding_id: string; readonly after_cursor?: number; readonly limit?: number }) => Promise<RelayResult<OutboxPage>>
  readonly ack: (request: { readonly binding_id: string; readonly cursor: number; readonly provider_message_id?: string }) => Promise<RelayResult<{ readonly binding_id: string; readonly acked_cursor: number; readonly changed: boolean }>>
  /** `binding_id` is the binding the answer arrived THROUGH (the connector's authenticated context), never read from the token. */
  readonly answer: (request: { readonly binding_id: string; readonly reply_token: string; readonly answer: string }) => Promise<RelayResult<{ readonly binding_id: string; readonly cursor: number; readonly session_durable_id: string }>>
  /** A connector's inbound message: delivered to the bound session with the binding's `inbound_mode`; one `event_id` is admitted once. */
  readonly inbound: (request: { readonly binding_id: string; readonly event_id: string; readonly text: string }) => Promise<GatewayDeliveryResult>
  /** The session settled: armed completions become outbox rows with this outcome. */
  readonly settle: (request: { readonly session_durable_id: string; readonly outcome: CompletionOutcome }) => Promise<readonly { readonly binding_id: string; readonly cursor: number }[]>
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
  idempotency_conflict: "Retry with a new idempotency_key.",
  idempotency_uncertain: "Call thread_bindings or thread_outbox to see the current state before retrying with a new key.",
  scope_denied: "Report through a binding attached to this session; thread_bindings lists them.",
  unsupported: "Report only the events the binding subscribes to, through a binding with an outbound direction.",
  not_found: "Call thread_bindings for the binding ids that exist.",
  cursor_invalid: "Read thread_outbox again and ack a cursor it returned.",
  host_unavailable: "Retry when the session is running; the question stays pending.",
  invalid_arguments: "Fix the arguments and call again.",
}

function failure(code: ThreadErrorCode, message: string, details?: Readonly<Record<string, unknown>>): { readonly kind: "error"; readonly error: ThreadToolFailure } {
  return { kind: "error", error: threadToolFailure(code, message, NEXT_ACTION[code] ?? "Call thread_bindings and retry after checking the binding.", details) }
}

function fromStore<T extends object>(outcome: RelayOutcome<T> | StoreRefusal): RelayResult<T> {
  if (outcome.kind === "refused") return failure(outcome.code, outcome.message, outcome.details)
  return outcome as RelayResult<T>
}

function textTooLarge(text: string): { readonly kind: "error"; readonly error: ThreadToolFailure } | undefined {
  const bytes = Buffer.byteLength(text)
  return bytes > RELAY_TEXT_MAX_BYTES ? failure("message_too_large", `The text is ${bytes} bytes, above the ${RELAY_TEXT_MAX_BYTES}-byte limit.`) : undefined
}

function receipt(request: Keyed, operation: string, args: unknown) {
  return request.idempotency_key === undefined ? null : { principal: request.principal, operation, idempotency_key: request.idempotency_key, args_hash: hashArgs(args) }
}

export function createGatewayRelay(options: GatewayRelayOptions): GatewayRelay {
  const now = options.now ?? Date.now
  const store = options.store

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
      const args = { session_durable_id: request.session_durable_id, binding_id: request.binding_id ?? null, event: request.event, text: request.text, ui_request_id: request.request_id ?? null }
      return fromStore(await store.report({ now: now(), receipt: receipt(request, "thread_report", args), ...args })) as RelayResult<ReportOpResult & { deduplicated: boolean }>
    },
    outbox: async (request) => fromStore(await store.readOutbox({ now: now(), ...request })),
    ack: async (request) => fromStore(await store.ackOutbox({ now: now(), ...request })),
    answer: async (request) => {
      const tooLarge = textTooLarge(request.answer)
      if (tooLarge !== undefined) return tooLarge
      const claim = await store.claimAnswer({ now: now(), ...request })
      if (claim.kind !== "ok") return fromStore(claim)
      const respond = options.endpoints.respondUi
      const endpoint = respond === undefined ? null : await options.locate(claim.session_durable_id)
      if (respond === undefined || endpoint === null) {
        await store.releaseAnswer({ reply_token: request.reply_token })
        return failure(respond === undefined ? "unsupported" : "host_unavailable", "The session that asked is not reachable to take the answer.", { session: claim.session_durable_id })
      }
      try {
        await respond(endpoint, { id: claim.ui_request_id, value: request.answer })
      } catch (error) {
        await store.releaseAnswer({ reply_token: request.reply_token })
        return failure("host_unavailable", `The answer could not be handed to the session: ${error instanceof Error ? error.message : String(error)}`, { session: claim.session_durable_id })
      }
      return { kind: "ok", binding_id: request.binding_id, cursor: claim.cursor, session_durable_id: claim.session_durable_id }
    },
    inbound: async (request) => {
      const binding = await store.bindingView({ now: now(), binding_id: request.binding_id })
      if (binding === null) return failure("not_found", "No binding has this id.", { binding_id: request.binding_id })
      if (binding.status !== "active") return failure("binding_inactive", `The binding is ${binding.status}.`, { binding_id: binding.binding_id, status: binding.status })
      if (!binding.direction.inbound) return failure("unsupported", "The binding carries no inbound direction.", { binding_id: binding.binding_id })
      return await options.engine.deliver({
        sender: {
          kind: "external",
          origin: { platform: binding.platform, account_id: binding.account_id, chat_id: binding.chat_id, thread_id: binding.thread_id, message_id: request.event_id },
          binding_id: binding.binding_id,
          binding_revision: binding.revision,
        },
        target: binding.session_durable_id,
        text: request.text,
        mode: binding.inbound_mode,
        all_scope: true,
        idempotency_key: `event:${request.event_id}`,
      })
    },
    settle: (request) => store.emitCompletions({ now: now(), ...request }),
  }
}
