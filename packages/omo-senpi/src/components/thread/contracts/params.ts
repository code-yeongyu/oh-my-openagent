import { type Static, Type } from "typebox"

import {
  AllScope,
  BindingId,
  ExpectedTurnId,
  IdempotencyKey,
  Message,
  Summary,
  THREAD_READ_DEFAULT_BYTES,
  THREAD_READ_MAX_BYTES,
  ThreadAddress,
  ThreadDeliveryMode,
  RelayText,
  thinkingLevel,
} from "./fields"
import { ThreadCreateParams } from "./create-params"

export { ThreadCreateParams }

export const ThreadListParams = Type.Object({
  all_scope: Type.Optional(
    Type.Boolean({
      description:
        "List this machine's threads from every workspace; the default returns only the caller's workspace here. The account's other devices' threads are always listed.",
    }),
  ),
  state: Type.Optional(
    Type.Array(
      Type.Union([Type.Literal("running"), Type.Literal("idle"), Type.Literal("inactive"), Type.Literal("archived")]),
      {
        minItems: 1,
        description:
          "Thread states to list: running, idle, inactive (no engine holds it) or archived; the default lists every state but archived.",
      },
    ),
  ),
})

/** The longest a `thread_read` waits for its thread to settle (#13417). */
const THREAD_READ_WAIT_MAX_MS = 600_000

export const ThreadReadParams = Type.Object({
  thread: ThreadAddress,
  cursor: Type.Optional(
    Type.String({
      description:
        "Opaque cursor from an earlier thread_read (tool.thread_read() in an eval cell) to page the older messages of a truncated read (a read without one returns the newest messages that fit max_bytes); a transcript revision that moved past it returns cursor_stale.",
    }),
  ),
  max_bytes: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: THREAD_READ_MAX_BYTES,
      description: `Byte budget for the returned transcript slice, default ${THREAD_READ_DEFAULT_BYTES} and capped at ${THREAD_READ_MAX_BYTES}; a longer transcript returns truncated with next_cursor.`,
    }),
  ),
  wait_ms: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: THREAD_READ_WAIT_MAX_MS,
      description: "Wait up to this many ms for the thread's turn to end, then read; see result.wait.",
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
      description:
        "Running turn to stop, defaulting to the newest running turn; interrupting an idle thread returns success with interrupted false.",
    }),
  ),
  all_scope: AllScope,
})

const SelfOrThread = Type.Optional(
  Type.String({
    minLength: 1,
    description:
      "Thread to act on. Omit or pass self for this session. Accepts the thread value of a thread_list row (tool.thread_list() in an eval cell), an alias, or a unique name. A miss names the thread value to pass.",
  }),
)

const ThreadCloseParams = Type.Object({
  thread: SelfOrThread,
  idempotency_key: IdempotencyKey,
  all_scope: AllScope,
  force: Type.Optional(
    Type.Boolean({
      description:
        "Close even when the thread has messages it has not read yet; they are dropped and listed in dropped_deliveries.",
    }),
  ),
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
  thread: SelfOrThread,
  name: Type.Optional(
    Type.String({
      minLength: 1,
      maxLength: 200,
      description:
        "New display label for the thread; the thread keeps its id as its address, and a label already used by another visible thread returns name_conflict.",
    }),
  ),
  alias: Type.Optional(
    Type.String({
      minLength: 1,
      maxLength: 64,
      description:
        'New account-wide alias for the thread; an alias another thread holds returns alias_taken naming the holder, and the old alias is freed. With no signed-in account it becomes the thread\'s local name instead (unless name is set) and the result carries alias_scope "local".',
    }),
  ),
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
  level: thinkingLevel(
    "Thinking level to apply; a level the thread's active model cannot run returns thinking_level_unsupported with the supported list and leaves the thread unchanged.",
  ),
  scope: Type.Optional(
    Type.Union([Type.Literal("session"), Type.Literal("turn")], {
      description:
        "session (default) or turn; either changes only this thread's level and never the level the device remembers for the model.",
    }),
  ),
  all_scope: AllScope,
  idempotency_key: IdempotencyKey,
})

const ThreadArchiveParams = Type.Object({
  thread: ThreadAddress,
  archived: Type.Optional(
    Type.Boolean({
      description:
        "true (the default) archives the thread, so thread_list (tool.thread_list() in an eval cell) hides it unless state includes archived; false unarchives it.",
    }),
  ),
  all_scope: AllScope,
  idempotency_key: IdempotencyKey,
})

export const ThreadReportParams = Type.Object({
  binding_id: Type.Optional(
    Type.String({
      minLength: 1,
      description:
        "Binding to report to; defaults to the originating binding, the one the message this session is answering now arrived through; refused when that is ambiguous.",
    }),
  ),
  kind: Type.Union(
    [Type.Literal("milestone"), Type.Literal("report"), Type.Literal("question"), Type.Literal("completion")],
    {
      description:
        "milestone updates the thread's progress message, report posts a result, question relays a pending question of this session and returns a reply_token, completion is written once when this session's run settles, with the run's real outcome.",
    },
  ),
  text: RelayText,
  request_id: Type.Optional(
    Type.String({
      minLength: 1,
      description: "For kind question: the id of this session's pending extension UI request the answer resolves.",
    }),
  ),
  request_kind: Type.Optional(
    Type.Union(
      [
        Type.Literal("question"),
        Type.Literal("select"),
        Type.Literal("confirm"),
        Type.Literal("input"),
        Type.Literal("editor"),
      ],
      {
        description:
          "For kind question: which extension UI request request_id is. It decides the answer forms thread_answer (tool.thread_answer() in an eval cell) accepts: confirm takes yes/no (any case, surrounding spaces ignored), input and editor take any text including empty, question and select take non-blank text. Without it the answer goes out in every text form at once, so a question, select, input or editor each reads its own and the text must be non-blank; a yes/no word also goes out as the confirm field, so an undeclared confirm reads yes/no too (any other text reads as no).",
      },
    ),
  ),
  idempotency_key: IdempotencyKey,
})

export const ThreadOutboxParams = Type.Object({
  binding_id: BindingId,
  after_cursor: Type.Optional(
    Type.Integer({
      minimum: 0,
      description: "Read rows after this cursor; unset continues after the binding's acknowledged cursor.",
    }),
  ),
  limit: Type.Optional(
    Type.Integer({ minimum: 1, maximum: 500, description: "Rows per read, default 100 and at most 500." }),
  ),
})

export const ThreadOutboxAckParams = Type.Object({
  binding_id: BindingId,
  cursor: Type.Integer({
    minimum: 1,
    description: "Every outbox row up to this cursor is marked delivered; an older cursor changes nothing.",
  }),
  provider_message_id: Type.Optional(
    Type.String({
      minLength: 1,
      maxLength: 256,
      description:
        "Platform id of the message posted for the row at cursor; the first one for a milestone becomes the progress message later milestones edit.",
    }),
  ),
})

export const ThreadAnswerParams = Type.Object({
  binding_id: Type.String({
    minLength: 1,
    description: "Binding the answer arrived through; it must be the binding that asked the question.",
  }),
  reply_token: Type.String({ minLength: 1, description: "reply_token of the question row being answered." }),
  answer: RelayText,
})

export type ThreadCreateInput = Static<typeof ThreadCreateParams>
export type ThreadListInput = Static<typeof ThreadListParams>
export type ThreadReadInput = Static<typeof ThreadReadParams>
export type ThreadSendInput = Static<typeof ThreadSendParams>
export type ThreadInterruptInput = Static<typeof ThreadInterruptParams>
export type ThreadCloseInput = Static<typeof ThreadCloseParams>
export type ThreadHandoffInput = Static<typeof ThreadHandoffParams>
export type ThreadRenameInput = Static<typeof ThreadRenameParams>
export type ThreadSetModelInput = Static<typeof ThreadSetModelParams>
export type ThreadSetReasoningInput = Static<typeof ThreadSetReasoningParams>
export type ThreadArchiveInput = Static<typeof ThreadArchiveParams>
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
  thread_close: ThreadCloseParams,
  thread_handoff: ThreadHandoffParams,
  thread_rename: ThreadRenameParams,
  thread_set_model: ThreadSetModelParams,
  thread_set_reasoning: ThreadSetReasoningParams,
  thread_archive: ThreadArchiveParams,
  thread_report: ThreadReportParams,
  thread_outbox: ThreadOutboxParams,
  thread_outbox_ack: ThreadOutboxAckParams,
  thread_answer: ThreadAnswerParams,
} as const

export type ThreadToolName = keyof typeof threadToolParamSchemas
