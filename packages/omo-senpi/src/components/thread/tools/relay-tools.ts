import type { Static } from "typebox"

import {
  parseThreadParams,
  threadToolParamSchemas,
  type ThreadAnswerInput,
  type ThreadOutboxAckInput,
  type ThreadOutboxInput,
  type ThreadReportInput,
  type ThreadToolName,
  type ThreadToolResult,
} from "../contracts"
import type { ThreadErrorCode } from "../errors"
import type { GatewayRelay } from "../gateway/relay"
import { metadata, output, type AnyTool, type ToolOutput } from "./internals"
import { UNKNOWN_CALLER, type ThreadToolSurfaceOptions } from "./ports"

type RelayToolName = "thread_report" | "thread_outbox" | "thread_outbox_ack" | "thread_answer"

export type RelayToolsContext = {
  readonly options: ThreadToolSurfaceOptions
  readonly relay: GatewayRelay
  readonly failure: (
    code: ThreadErrorCode,
    message: string,
    next: string,
    details?: Readonly<Record<string, unknown>>,
  ) => ThreadToolResult
}

type Call<T extends RelayToolName> = {
  readonly value: Static<(typeof threadToolParamSchemas)[T]>
  readonly callerId: string
  readonly key: string
}

/**
 * The four relay tools. They run over the gateway store alone and take no host listing, so a
 * terminal with no host running can still report and read its outbox. Binding a chat thread is
 * not a session tool: the gateway writes, moves and expires bindings through the relay SDK as its
 * own principal. Mutations are idempotent per `(caller, tool, key)` inside the store transaction
 * that performs them.
 */
export function createRelayTools(context: RelayToolsContext): AnyTool[] {
  const { options, relay, failure } = context

  async function run<T extends RelayToolName>(
    name: T,
    callId: string,
    args: unknown,
    ectx: unknown,
    body: (call: Call<T>) => Promise<ThreadToolResult>,
  ): Promise<ToolOutput> {
    const callerId =
      (ectx as { sessionManager?: { getSessionId?: () => string } } | undefined)?.sessionManager?.getSessionId?.() ??
      options.callerSessionId()
    const parsed = parseThreadParams(threadToolParamSchemas[name], args)
    if (parsed.kind === "error") return output(parsed as ThreadToolResult)
    const value = parsed.value as Static<(typeof threadToolParamSchemas)[T]>
    const explicit =
      "idempotency_key" in value ? (value as { idempotency_key?: string }).idempotency_key?.trim() : undefined
    try {
      return output(
        await body({
          value,
          callerId,
          key: explicit !== undefined && explicit.length > 0 ? explicit : `call:${callId}`,
        }),
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.startsWith("host_unavailable:"))
        return output(
          failure(
            "host_unavailable",
            `The thread host is unavailable at ${message.slice("host_unavailable:".length)}.`,
            "Retry when the session's host is running, or address the calling session with self.",
          ),
        )
      return output(
        failure(
          "internal_error",
          `Thread relay operation failed: ${message}`,
          "Retry; thread_report without binding_id uses the chat binding the gateway keeps for this session.",
        ),
      )
    }
  }

  const principal = (callerId: string) => `session:${callerId}`

  const tool = <T extends RelayToolName>(name: T, body: (call: Call<T>) => Promise<ThreadToolResult>): AnyTool => ({
    ...metadata(name as ThreadToolName),
    parameters: threadToolParamSchemas[name],
    execute: (id: string, args: unknown, _signal: unknown, _onUpdate: unknown, ectx: unknown) =>
      run(name, id, args, ectx, body),
  })

  return [
    tool("thread_report", async ({ value, callerId, key }) => {
      const input = value as ThreadReportInput
      if (callerId === UNKNOWN_CALLER)
        return failure(
          "caller_context_missing",
          "A report comes from the calling session, whose durable id is unknown.",
          "Retry from a session that passes its execution context.",
        )
      const origins = input.binding_id === undefined ? options.callerRunDeliveries?.() : undefined
      const localInput = input.binding_id === undefined && options.callerRunHasLocalInput?.() === true
      const reported = await relay.report({
        principal: principal(callerId),
        idempotency_key: key,
        session_durable_id: callerId,
        ...(input.binding_id === undefined ? {} : { binding_id: input.binding_id }),
        ...(origins === undefined ? {} : { origin_delivery_ids: origins }),
        ...(localInput ? { origin_local_input: true } : {}),
        event: input.kind,
        text: input.text,
        ...(input.request_id === undefined ? {} : { request_id: input.request_id }),
        ...(input.request_kind === undefined ? {} : { request_kind: input.request_kind }),
      })
      if (reported.kind !== "ok") return reported as ThreadToolResult
      // The arm's sequence number is the settle watermark, internal to the component; the result stays as documented.
      const { arm_seq: reportedArmSeq, ...result } = reported
      if (typeof reportedArmSeq === "number" && Number.isInteger(reportedArmSeq))
        options.onCompletionArmed?.(callerId, reportedArmSeq)
      else if (result.armed) {
        // A replayed receipt written before arm_seq existed carries none: the session's newest durable arm is the watermark.
        const durableArmSeq = await options.store.latestCompletionArm(callerId)
        if (durableArmSeq === null)
          return failure(
            "idempotency_uncertain",
            "An earlier completion report under this key was recorded without its arm sequence, and the session has no completion armed now: its completion was already written, or the arm is gone.",
            "Read the binding's outbox with thread_outbox to see whether the completion was sent; to arm another, report again under a new idempotency_key.",
          )
        options.onCompletionArmed?.(callerId, durableArmSeq)
      }
      return result as ThreadToolResult
    }),
    tool("thread_outbox", async ({ value }) => {
      const input = value as ThreadOutboxInput
      return (await relay.outbox({
        binding_id: input.binding_id,
        ...(input.after_cursor === undefined ? {} : { after_cursor: input.after_cursor }),
        ...(input.limit === undefined ? {} : { limit: input.limit }),
      })) as ThreadToolResult
    }),
    tool("thread_outbox_ack", async ({ value }) => {
      const input = value as ThreadOutboxAckInput
      return (await relay.ack({
        binding_id: input.binding_id,
        cursor: input.cursor,
        ...(input.provider_message_id === undefined ? {} : { provider_message_id: input.provider_message_id }),
      })) as ThreadToolResult
    }),
    tool("thread_answer", async ({ value }) => {
      const input = value as ThreadAnswerInput
      return (await relay.answer({
        binding_id: input.binding_id,
        reply_token: input.reply_token,
        answer: input.answer,
      })) as ThreadToolResult
    }),
  ]
}
