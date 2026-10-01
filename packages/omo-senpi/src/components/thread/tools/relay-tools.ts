import type { Static } from "typebox"

import {
  parseThreadParams,
  threadToolParamSchemas,
  type ThreadAnswerInput,
  type ThreadBindingsInput,
  type ThreadBindInput,
  type ThreadOutboxAckInput,
  type ThreadOutboxInput,
  type ThreadRebindInput,
  type ThreadReportInput,
  type ThreadToolName,
  type ThreadToolResult,
  type ThreadUnbindInput,
} from "../contracts"
import type { ThreadErrorCode } from "../errors"
import type { GatewayRelay } from "../gateway/relay"
import { metadata, output, resolveStoredSession, type AnyTool, type ToolOutput } from "./internals"
import { UNKNOWN_CALLER, type ThreadHostView, type ThreadHostViewRequest, type ThreadToolSurfaceOptions } from "./ports"

type RelayToolName = "thread_bind" | "thread_unbind" | "thread_rebind" | "thread_bindings" | "thread_report" | "thread_outbox" | "thread_outbox_ack" | "thread_answer"

export type RelayToolsContext = {
  readonly options: ThreadToolSurfaceOptions
  readonly relay: GatewayRelay
  readonly view: (request: ThreadHostViewRequest) => Promise<ThreadHostView>
  readonly failure: (code: ThreadErrorCode, message: string, next: string, details?: Readonly<Record<string, unknown>>) => ThreadToolResult
}

type Call<T extends RelayToolName> = {
  readonly value: Static<(typeof threadToolParamSchemas)[T]>
  readonly callerId: string
  readonly key: string
}

/**
 * The eight relay tools. They run over the gateway store alone: no host listing is taken unless a
 * session address other than the caller has to be resolved, so a terminal with no host running
 * can still bind, report and read its outbox. Mutations are idempotent per `(caller, tool, key)`
 * inside the store transaction that performs them.
 */
export function createRelayTools(context: RelayToolsContext): AnyTool[] {
  const { options, relay, failure } = context

  async function run<T extends RelayToolName>(name: T, callId: string, args: unknown, ectx: unknown, body: (call: Call<T>) => Promise<ThreadToolResult>): Promise<ToolOutput> {
    const callerId = (ectx as { sessionManager?: { getSessionId?: () => string } } | undefined)?.sessionManager?.getSessionId?.() ?? options.callerSessionId()
    const parsed = parseThreadParams(threadToolParamSchemas[name], args)
    if (parsed.kind === "error") return output(parsed as ThreadToolResult)
    const value = parsed.value as Static<(typeof threadToolParamSchemas)[T]>
    const explicit = "idempotency_key" in value ? (value as { idempotency_key?: string }).idempotency_key?.trim() : undefined
    try {
      return output(await body({ value, callerId, key: explicit !== undefined && explicit.length > 0 ? explicit : `call:${callId}` }))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.startsWith("host_unavailable:")) return output(failure("host_unavailable", `The thread host is unavailable at ${message.slice("host_unavailable:".length)}.`, "Retry when the session's host is running, or address the calling session with self."))
      return output(failure("internal_error", `Thread relay operation failed: ${message}`, "Call thread_bindings and retry after checking the binding."))
    }
  }

  async function sessionOf(address: string | undefined, callerId: string, allScope: boolean | undefined): Promise<{ readonly id: string } | ThreadToolResult> {
    if (address === undefined || address === "self" || (address === callerId && callerId !== UNKNOWN_CALLER)) {
      if (callerId === UNKNOWN_CALLER) return failure("caller_context_missing", "The calling session's durable id is unknown.", "Name the session explicitly, or retry from a session that passes its execution context.")
      return { id: callerId }
    }
    const resolved = await resolveStoredSession(options, context.view, address, callerId, allScope)
    if (resolved.kind === "error") return { kind: "error", error: resolved }
    return { id: resolved.entry.thread_id }
  }

  const principal = (callerId: string) => `session:${callerId}`

  const tool = <T extends RelayToolName>(name: T, body: (call: Call<T>) => Promise<ThreadToolResult>): AnyTool => ({
    ...metadata(name as ThreadToolName),
    parameters: threadToolParamSchemas[name],
    execute: (id: string, args: unknown, _signal: unknown, _onUpdate: unknown, ectx: unknown) => run(name, id, args, ectx, body),
  })

  return [
    tool("thread_bind", async ({ value, callerId, key }) => {
      const input = value as ThreadBindInput
      const session = await sessionOf(input.session, callerId, input.all_scope)
      if ("kind" in session) return session
      return (await relay.bind({
        principal: principal(callerId),
        idempotency_key: key,
        binding: {
          platform: input.platform,
          account_id: input.account_id,
          chat_id: input.chat_id,
          ...(input.thread_id === undefined ? {} : { thread_id: input.thread_id }),
          ...(input.root_message_id === undefined ? {} : { root_message_id: input.root_message_id }),
          ...(input.progress_message_id === undefined ? {} : { progress_message_id: input.progress_message_id }),
          session_durable_id: session.id,
          ...(input.direction === undefined ? {} : { direction: input.direction }),
          ...(input.inbound_mode === undefined ? {} : { inbound_mode: input.inbound_mode }),
          ...(input.outbound_events === undefined ? {} : { outbound_events: input.outbound_events }),
          ...(input.policy_id === undefined ? {} : { policy_id: input.policy_id }),
          ...(input.ttl_seconds === undefined ? {} : { ttl_seconds: input.ttl_seconds }),
        },
      })) as ThreadToolResult
    }),
    tool("thread_unbind", async ({ value, callerId, key }) => {
      const input = value as ThreadUnbindInput
      return (await relay.unbind({ principal: principal(callerId), idempotency_key: key, binding_id: input.binding_id, expected_revision: input.expected_revision })) as ThreadToolResult
    }),
    tool("thread_rebind", async ({ value, callerId, key }) => {
      const input = value as ThreadRebindInput
      const session = await sessionOf(input.session, callerId, input.all_scope)
      if ("kind" in session) return session
      return (await relay.rebind({ principal: principal(callerId), idempotency_key: key, binding_id: input.binding_id, expected_revision: input.expected_revision, session_durable_id: session.id })) as ThreadToolResult
    }),
    tool("thread_bindings", async ({ value, callerId }) => {
      const input = value as ThreadBindingsInput
      let sessionFilter: string | undefined
      if (input.session !== undefined) {
        const session = await sessionOf(input.session, callerId, input.all_scope)
        if ("kind" in session) return session
        sessionFilter = session.id
      }
      return (await relay.bindings({
        filter: {
          ...(sessionFilter === undefined ? {} : { session_durable_id: sessionFilter }),
          ...(input.platform === undefined ? {} : { platform: input.platform }),
          ...(input.account_id === undefined ? {} : { account_id: input.account_id }),
          ...(input.chat_id === undefined ? {} : { chat_id: input.chat_id }),
          ...(input.thread_id === undefined ? {} : { thread_id: input.thread_id }),
          ...(input.status === undefined ? {} : { status: input.status }),
        },
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
        ...(input.limit === undefined ? {} : { limit: input.limit }),
      })) as ThreadToolResult
    }),
    tool("thread_report", async ({ value, callerId, key }) => {
      const input = value as ThreadReportInput
      if (callerId === UNKNOWN_CALLER) return failure("caller_context_missing", "A report comes from the calling session, whose durable id is unknown.", "Retry from a session that passes its execution context.")
      const origins = input.binding_id === undefined ? options.callerRunDeliveries?.() : undefined
      const reported = await relay.report({
        principal: principal(callerId),
        idempotency_key: key,
        session_durable_id: callerId,
        ...(input.binding_id === undefined ? {} : { binding_id: input.binding_id }),
        ...(origins === undefined ? {} : { origin_delivery_ids: origins }),
        event: input.kind,
        text: input.text,
        ...(input.request_id === undefined ? {} : { request_id: input.request_id }),
        ...(input.request_kind === undefined ? {} : { request_kind: input.request_kind }),
      })
      if (reported.kind === "ok" && reported.armed) options.onCompletionArmed?.(callerId)
      return reported as ThreadToolResult
    }),
    tool("thread_outbox", async ({ value }) => {
      const input = value as ThreadOutboxInput
      return (await relay.outbox({ binding_id: input.binding_id, ...(input.after_cursor === undefined ? {} : { after_cursor: input.after_cursor }), ...(input.limit === undefined ? {} : { limit: input.limit }) })) as ThreadToolResult
    }),
    tool("thread_outbox_ack", async ({ value }) => {
      const input = value as ThreadOutboxAckInput
      return (await relay.ack({ binding_id: input.binding_id, cursor: input.cursor, ...(input.provider_message_id === undefined ? {} : { provider_message_id: input.provider_message_id }) })) as ThreadToolResult
    }),
    tool("thread_answer", async ({ value }) => {
      const input = value as ThreadAnswerInput
      return (await relay.answer({ binding_id: input.binding_id, reply_token: input.reply_token, answer: input.answer })) as ThreadToolResult
    }),
  ]
}
