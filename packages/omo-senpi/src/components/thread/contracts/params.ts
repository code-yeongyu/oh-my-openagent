import { type Static, Type } from "typebox"

import {
  AllScope,
  BindingId,
  ExpectedRevision,
  ExpectedTurnId,
  IdempotencyKey,
  Message,
  Summary,
  THREAD_READ_DEFAULT_BYTES,
  THREAD_READ_MAX_BYTES,
  ThreadAddress,
  ThreadDeliveryMode,
  RelayText,
} from "./fields"

const BINDING_PLATFORM = Type.Union(
  [Type.Literal("discord"), Type.Literal("telegram"), Type.Literal("slack"), Type.Literal("notion"), Type.Literal("feishu"), Type.Literal("herdr"), Type.Literal("custom")],
  { description: "Chat platform of the external conversation; custom covers any other connector." },
)

const OUTBOUND_EVENT = Type.Union([Type.Literal("milestone"), Type.Literal("report"), Type.Literal("question"), Type.Literal("completion")])

const BoundSession = Type.Optional(
  Type.String({
    description: "Thread id or unique name of the session to attach, as returned by thread_list; self or leaving it unset attaches the calling session.",
  }),
)

export const ThreadCreateParams = Type.Object({
  name: Type.Optional(
    Type.String({
      description:
        "Display label for the new thread; an existing thread with the same normalized name returns name_conflict, and later renames change only the label while thread_id stays the address.",
    }),
  ),
  cwd: Type.Optional(
    Type.String({
      description: "Working directory the new thread runs in; leaving it unset keeps the thread inside the caller's workspace.",
    }),
  ),
  fork_from: Type.Optional(
    Type.String({
      description: "Durable id of an existing thread to fork; the new thread starts with that transcript as prior context.",
    }),
  ),
  provider: Type.Optional(
    Type.String({ description: "Restricts the model choice to one provider; with a bare model id it names which provider serves it." }),
  ),
  model: Type.Optional(
    Type.String({
      minLength: 1,
      description:
        "Model the new thread runs, as provider/id, an exact model id, or a unique fragment of the id or display name; unset picks the best model the user's connected providers serve, in the active model profile's order.",
    }),
  ),
  thinking: Type.Optional(
    Type.Union(
      [Type.Literal("off"), Type.Literal("minimal"), Type.Literal("low"), Type.Literal("medium"), Type.Literal("high"), Type.Literal("xhigh"), Type.Literal("max")],
      { description: "Thinking level the new thread starts at; a level the chosen model cannot run returns thinking_level_unsupported with the supported list." },
    ),
  ),
  idempotency_key: IdempotencyKey,
})

export const ThreadListParams = Type.Object({
  all_scope: Type.Optional(
    Type.Boolean({
      description: "List threads from every workspace on this machine; the default scope returns only the caller's workspace.",
    }),
  ),
})

export const ThreadReadParams = Type.Object({
  thread: ThreadAddress,
  cursor: Type.Optional(
    Type.String({
      description:
        "Opaque cursor from an earlier thread_read to continue a truncated transcript; a transcript revision that moved past it returns cursor_stale.",
    }),
  ),
  max_bytes: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: THREAD_READ_MAX_BYTES,
      description: `Byte budget for the returned transcript slice, default ${THREAD_READ_DEFAULT_BYTES} and capped at ${THREAD_READ_MAX_BYTES}; a longer transcript returns truncated with next_cursor.`,
    }),
  ),
  all_scope: AllScope,
})

export const ThreadSendParams = Type.Object({
  thread: ThreadAddress,
  message: Message,
  delivery: Type.Optional(ThreadDeliveryMode),
  expected_turn_id: ExpectedTurnId,
  summary: Summary,
  idempotency_key: IdempotencyKey,
  all_scope: AllScope,
})

export const ThreadInterruptParams = Type.Object({
  thread: ThreadAddress,
  turn_id: Type.Optional(
    Type.String({
      description: "Running turn to stop, defaulting to the newest running turn; interrupting an idle thread returns success with interrupted false.",
    }),
  ),
  all_scope: AllScope,
})

export const ThreadHandoffParams = Type.Object({
  thread: Type.String({
    description:
      "Thread id or name to reopen after a pause; the fuzzy resolver also accepts partial names and workspace basenames, and a close runner-up returns ambiguous_target with candidates.",
  }),
  match: Type.Optional(
    Type.Union([Type.Literal("exact"), Type.Literal("fuzzy")], {
      description:
        "exact resolves a thread id or a unique name; fuzzy additionally ranks partial names and workspace basenames and returns the top match only when it clearly leads its runner-up.",
    }),
  ),
  message: Message,
  delivery: Type.Optional(ThreadDeliveryMode),
  expected_turn_id: ExpectedTurnId,
  summary: Summary,
  idempotency_key: IdempotencyKey,
  all_scope: AllScope,
})

export const ThreadRenameParams = Type.Object({
  thread: ThreadAddress,
  name: Type.String({
    minLength: 1,
    maxLength: 200,
    description:
      "New display label for the thread; the thread keeps its id as its address, and a label already used by another visible thread returns name_conflict.",
  }),
  all_scope: AllScope,
  idempotency_key: IdempotencyKey,
})

export const ThreadSetModelParams = Type.Object({
  thread: ThreadAddress,
  model: Type.String({
    minLength: 1,
    description:
      "Model to switch the thread to, as provider/id, an exact model id, or a case-insensitive fragment of the id or display name resolved against the host's model catalog; no match returns model_not_found with the available list, several matches return model_ambiguous with candidates.",
  }),
  provider: Type.Optional(
    Type.String({
      description:
        "Restricts resolution to one provider when the fragment alone would match models from several providers.",
    }),
  ),
  all_scope: AllScope,
  idempotency_key: IdempotencyKey,
})

export const ThreadSetReasoningParams = Type.Object({
  thread: ThreadAddress,
  level: Type.Union(
    [
      Type.Literal("off"),
      Type.Literal("minimal"),
      Type.Literal("low"),
      Type.Literal("medium"),
      Type.Literal("high"),
      Type.Literal("xhigh"),
      Type.Literal("max"),
    ],
    {
      description:
        "Thinking level to apply; a level the thread's active model cannot run returns thinking_level_unsupported with the supported list and leaves the thread unchanged.",
    },
  ),
  scope: Type.Optional(
    Type.Union([Type.Literal("session"), Type.Literal("turn")], {
      description:
        "session (default) changes the thread's remembered level for its model; turn changes only the current session level without rewriting the model's remembered level.",
    }),
  ),
  all_scope: AllScope,
  idempotency_key: IdempotencyKey,
})

export const ThreadBindParams = Type.Object({
  platform: BINDING_PLATFORM,
  account_id: Type.String({ minLength: 1, maxLength: 256, description: "Bot or account id the connector speaks as on that platform." }),
  chat_id: Type.String({ minLength: 1, maxLength: 256, description: "Channel, group or direct-chat id on the platform." }),
  thread_id: Type.Optional(
    Type.String({ minLength: 1, maxLength: 256, description: "Thread id inside the chat; @chat (the default) binds the whole chat on platforms without threads." }),
  ),
  root_message_id: Type.Optional(Type.String({ minLength: 1, maxLength: 256, description: "Platform id of the message that started the thread, when there is one." })),
  progress_message_id: Type.Optional(
    Type.String({ minLength: 1, maxLength: 256, description: "Platform id of an existing progress message that milestone reports edit in place." }),
  ),
  session: BoundSession,
  direction: Type.Optional(
    Type.Object(
      { inbound: Type.Boolean(), outbound: Type.Boolean() },
      { description: "inbound lets the thread's messages reach the session, outbound lets the session report to the thread; both default to true and at least one is required." },
    ),
  ),
  inbound_mode: Type.Optional(
    Type.Union([Type.Literal("auto"), Type.Literal("follow_up")], {
      description: "How inbound messages are delivered: auto starts a turn when the session is idle and queues behind a running one; follow_up always queues behind the running turn.",
    }),
  ),
  outbound_events: Type.Optional(
    Type.Array(OUTBOUND_EVENT, { maxItems: 4, description: "Report kinds this thread receives, each at most once; defaults to all four for an outbound binding." }),
  ),
  policy_id: Type.Optional(Type.String({ minLength: 1, maxLength: 256, description: "Connector policy label stored with the binding; default is default." })),
  ttl_seconds: Type.Optional(
    Type.Union([Type.Integer({ minimum: 1 }), Type.Null()], {
      description: "Lifetime in seconds from now, default 604800 (one week) and never extended; null keeps the binding until it is unbound.",
    }),
  ),
  all_scope: AllScope,
  idempotency_key: IdempotencyKey,
})

export const ThreadUnbindParams = Type.Object({
  binding_id: BindingId,
  expected_revision: ExpectedRevision,
  idempotency_key: IdempotencyKey,
})

export const ThreadRebindParams = Type.Object({
  binding_id: BindingId,
  expected_revision: ExpectedRevision,
  session: Type.String({ minLength: 1, description: "Thread id or unique name of the session that takes the binding over, as returned by thread_list." }),
  all_scope: AllScope,
  idempotency_key: IdempotencyKey,
})

export const ThreadBindingsParams = Type.Object({
  session: Type.Optional(Type.String({ minLength: 1, description: "Only bindings attached to this session (thread id, unique name, or self)." })),
  platform: Type.Optional(BINDING_PLATFORM),
  account_id: Type.Optional(Type.String({ minLength: 1, description: "Only bindings of this platform account." })),
  chat_id: Type.Optional(Type.String({ minLength: 1, description: "Only bindings in this chat." })),
  thread_id: Type.Optional(Type.String({ minLength: 1, description: "Only bindings of this thread id." })),
  status: Type.Optional(
    Type.Union([Type.Literal("active"), Type.Literal("detached"), Type.Literal("expired")], { description: "Only bindings in this status; all statuses when unset." }),
  ),
  cursor: Type.Optional(Type.String({ description: "next_cursor from an earlier thread_bindings call, to continue the same snapshot." })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, description: "Page size, default 50 and at most 200." })),
  all_scope: AllScope,
})

export const ThreadReportParams = Type.Object({
  binding_id: Type.Optional(
    Type.String({ minLength: 1, description: "Binding to report to; defaults to the originating binding, the one the message this session is answering now arrived through; refused when that is ambiguous." }),
  ),
  kind: Type.Union([Type.Literal("milestone"), Type.Literal("report"), Type.Literal("question"), Type.Literal("completion")], {
    description:
      "milestone updates the thread's progress message, report posts a result, question relays a pending question of this session and returns a reply_token, completion is written once when this session's run settles, with the run's real outcome.",
  }),
  text: RelayText,
  request_id: Type.Optional(
    Type.String({ minLength: 1, description: "For kind question: the id of this session's pending extension UI request the answer resolves." }),
  ),
  request_kind: Type.Optional(
    Type.Union([Type.Literal("question"), Type.Literal("select"), Type.Literal("confirm"), Type.Literal("input"), Type.Literal("editor")], {
      description: "For kind question: which extension UI request request_id is. It decides the answer forms thread_answer accepts: confirm takes yes/no (any case, surrounding spaces ignored), input and editor take any text including empty, question and select take non-blank text. Without it the answer goes out in every text form at once, so a question, select, input or editor each reads its own and the text must be non-blank; a yes/no word also goes out as the confirm field, so an undeclared confirm reads yes/no too (any other text reads as no).",
    }),
  ),
  idempotency_key: IdempotencyKey,
})

export const ThreadOutboxParams = Type.Object({
  binding_id: BindingId,
  after_cursor: Type.Optional(
    Type.Integer({ minimum: 0, description: "Read rows after this cursor; unset continues after the binding's acknowledged cursor." }),
  ),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500, description: "Rows per read, default 100 and at most 500." })),
})

export const ThreadOutboxAckParams = Type.Object({
  binding_id: BindingId,
  cursor: Type.Integer({ minimum: 1, description: "Every outbox row up to this cursor is marked delivered; an older cursor changes nothing." }),
  provider_message_id: Type.Optional(
    Type.String({ minLength: 1, maxLength: 256, description: "Platform id of the message posted for the row at cursor; the first one for a milestone becomes the progress message later milestones edit." }),
  ),
})

export const ThreadAnswerParams = Type.Object({
  binding_id: Type.String({ minLength: 1, description: "Binding the answer arrived through; it must be the binding that asked the question." }),
  reply_token: Type.String({ minLength: 1, description: "reply_token of the question row being answered." }),
  answer: RelayText,
})

export type ThreadCreateInput = Static<typeof ThreadCreateParams>
export type ThreadListInput = Static<typeof ThreadListParams>
export type ThreadReadInput = Static<typeof ThreadReadParams>
export type ThreadSendInput = Static<typeof ThreadSendParams>
export type ThreadInterruptInput = Static<typeof ThreadInterruptParams>
export type ThreadHandoffInput = Static<typeof ThreadHandoffParams>
export type ThreadRenameInput = Static<typeof ThreadRenameParams>
export type ThreadSetModelInput = Static<typeof ThreadSetModelParams>
export type ThreadSetReasoningInput = Static<typeof ThreadSetReasoningParams>
export type ThreadBindInput = Static<typeof ThreadBindParams>
export type ThreadUnbindInput = Static<typeof ThreadUnbindParams>
export type ThreadRebindInput = Static<typeof ThreadRebindParams>
export type ThreadBindingsInput = Static<typeof ThreadBindingsParams>
export type ThreadReportInput = Static<typeof ThreadReportParams>
export type ThreadOutboxInput = Static<typeof ThreadOutboxParams>
export type ThreadOutboxAckInput = Static<typeof ThreadOutboxAckParams>
export type ThreadAnswerInput = Static<typeof ThreadAnswerParams>

export const threadToolParamSchemas = {
  thread_create: ThreadCreateParams,
  thread_list: ThreadListParams,
  thread_read: ThreadReadParams,
  thread_send: ThreadSendParams,
  thread_interrupt: ThreadInterruptParams,
  thread_handoff: ThreadHandoffParams,
  thread_rename: ThreadRenameParams,
  thread_set_model: ThreadSetModelParams,
  thread_set_reasoning: ThreadSetReasoningParams,
  thread_bind: ThreadBindParams,
  thread_unbind: ThreadUnbindParams,
  thread_rebind: ThreadRebindParams,
  thread_bindings: ThreadBindingsParams,
  thread_report: ThreadReportParams,
  thread_outbox: ThreadOutboxParams,
  thread_outbox_ack: ThreadOutboxAckParams,
  thread_answer: ThreadAnswerParams,
} as const

export type ThreadToolName = keyof typeof threadToolParamSchemas
