import { type Static, Type } from "typebox"

import {
  AllScope,
  ExpectedTurnId,
  IdempotencyKey,
  Message,
  Summary,
  THREAD_READ_DEFAULT_BYTES,
  THREAD_READ_MAX_BYTES,
  ThreadAddress,
  ThreadDeliveryMode,
} from "./fields"

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

export type ThreadCreateInput = Static<typeof ThreadCreateParams>
export type ThreadListInput = Static<typeof ThreadListParams>
export type ThreadReadInput = Static<typeof ThreadReadParams>
export type ThreadSendInput = Static<typeof ThreadSendParams>
export type ThreadInterruptInput = Static<typeof ThreadInterruptParams>
export type ThreadHandoffInput = Static<typeof ThreadHandoffParams>
export type ThreadRenameInput = Static<typeof ThreadRenameParams>
export type ThreadSetModelInput = Static<typeof ThreadSetModelParams>
export type ThreadSetReasoningInput = Static<typeof ThreadSetReasoningParams>

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
} as const

export type ThreadToolName = keyof typeof threadToolParamSchemas
