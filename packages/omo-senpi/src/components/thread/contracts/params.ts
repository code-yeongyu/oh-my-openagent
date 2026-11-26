import { type Static, type TObject, type TSchema, Type } from "typebox"

import { THREAD_PARAM_ALIASES } from "./aliases"

import {
  AllScope,
  CollapseKey,
  ExpectedTurnId,
  IdempotencyKey,
  Message,
  Summary,
  THREAD_READ_DEFAULT_BYTES,
  THREAD_READ_DEFAULT_LIMIT,
  THREAD_READ_MAX_BYTES,
  THREAD_READ_MAX_LIMIT,
  ThreadAddress,
  ThreadDeliveryMode,
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
      Type.Union([
        Type.Literal("opening"),
        Type.Literal("running"),
        Type.Literal("idle"),
        Type.Literal("inactive"),
        Type.Literal("archived"),
      ]),
      {
        minItems: 1,
        description:
          "Thread states to list: opening (not yet ready for controls), running, idle, inactive (no engine holds it) or archived; the default lists every state but archived.",
      },
    ),
  ),
  query: Type.Optional(
    Type.String({
      minLength: 1,
      description:
        "List only the threads whose thread value, name, alias or folder (cwd) contains this text, ignoring case. Also accepted as search.",
    }),
  ),
  limit: Type.Optional(
    Type.Integer({
      minimum: 1,
      description: "List at most this many threads, in listing order; rows_omitted counts the rest.",
    }),
  ),
  idempotency_key: IdempotencyKey,
})

/** The longest a `thread_read` waits for its thread to settle (#13417). */
const THREAD_READ_WAIT_MAX_MS = 600_000

export const ThreadReadParams = Type.Object({
  thread: ThreadAddress,
  delivery_id: Type.Optional(
    Type.String({
      minLength: 1,
      maxLength: 128,
      description:
        "Query only the outcome of your original delivery to this exact thread ID. Reads no conversation, sends no message and wakes no session; after evidence expires answers outcome_unavailable.",
    }),
  ),
  cursor: Type.Optional(
    Type.String({
      description:
        "Opaque cursor from an earlier thread_read (tool.thread_read() in an eval cell) to page the older messages of a truncated read (a read without one returns the newest messages that fit max_bytes); a transcript revision that moved past it returns cursor_stale.",
    }),
  ),
  limit: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: THREAD_READ_MAX_LIMIT,
      description: `How many of the newest messages to read, default ${THREAD_READ_DEFAULT_LIMIT}, at most ${THREAD_READ_MAX_LIMIT}; max_bytes still bounds the slice, and next_cursor pages the older part of those messages. Not combined with cursor. Also accepted as tail, lines, count or last.`,
    }),
  ),
  max_bytes: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: THREAD_READ_MAX_BYTES,
      description: `Byte budget for the returned transcript slice, default ${THREAD_READ_DEFAULT_BYTES} and capped at ${THREAD_READ_MAX_BYTES}; a longer transcript returns truncated with next_cursor. Also accepted as limit_bytes or bytes.`,
    }),
  ),
  wait_ms: Type.Optional(
    Type.Integer({
      minimum: 0,
      maximum: THREAD_READ_WAIT_MAX_MS,
      description: "Wait up to this many ms for the thread's turn to end, then read; see result.wait. 0 reads at once.",
    }),
  ),
  all_scope: AllScope,
  idempotency_key: IdempotencyKey,
})

export const ThreadSendParams = Type.Object({
  thread: ThreadAddress,
  message: Message,
  delivery: Type.Optional(ThreadDeliveryMode),
  expected_turn_id: ExpectedTurnId,
  summary: Summary,
  idempotency_key: IdempotencyKey,
  collapse_key: CollapseKey,
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
  idempotency_key: IdempotencyKey,
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
  graceful: Type.Optional(
    Type.Boolean({
      description:
        "Let the running turn end instead of stopping it; new messages are refused and unread ones go back to their senders. Monitors, loops and the goal stop cleanly. Also closes a terminal's thread, which then exits.",
    }),
  ),
  wait_ms: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: 600_000,
      description: "How long a graceful close waits for the turn (default 30000, cut to what the call has left).",
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
        "New display label for the thread; the thread keeps its id as its address, and a label already used by another visible thread returns name_conflict. Also accepted as title.",
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
      "Model to switch the thread to, as provider/id, an exact model id, or a case-insensitive fragment of the id or display name, resolved against the target's catalog. Append a thinking level such as :max to apply it after switching. No match returns model_not_found with the available list; an absent provider adds details.reason = provider_not_configured and lists the target's available providers. Several matches return model_ambiguous with candidates.",
  }),
  provider: Type.Optional(
    Type.String({
      description:
        "Restricts resolution to one provider when the fragment alone would match models from several providers.",
    }),
  ),
  reasoning: Type.Optional(
    thinkingLevel(
      "Thinking level to apply after switching, the same as appending :<level> to model; a model that already ends in a different level is refused.",
    ),
  ),
  all_scope: AllScope,
  idempotency_key: IdempotencyKey,
})

export const ThreadSetReasoningParams = Type.Object({
  thread: ThreadAddress,
  level: thinkingLevel(
    "Thinking level to apply; a level the thread's active model cannot run returns thinking_level_unsupported with the supported list and leaves the thread unchanged. Also accepted as reasoning, thinking or thinking_level.",
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
} as const

export type ThreadToolName = keyof typeof threadToolParamSchemas

/**
 * The schema a thread tool declares to its host (#15073). The host validates a call against it before the tool runs, so a
 * required field that has an alias is optional there: a call naming the alias (`thread_send` `text`) reaches
 * parseThreadParams, which maps it and still requires the field against the full schema.
 */
export function declaredThreadParams(tool: ThreadToolName): TObject {
  const schema: TObject = threadToolParamSchemas[tool]
  const aliased = new Set(Object.values(THREAD_PARAM_ALIASES[tool] ?? {}))
  const required = new Set(schema.required ?? [])
  if (![...aliased].some((field) => required.has(field))) return schema
  const properties: Record<string, TSchema> = Object.fromEntries(
    Object.entries(schema.properties as Record<string, TSchema>).map(([field, property]) => [
      field,
      aliased.has(field) && required.has(field) ? Type.Optional(property) : property,
    ]),
  )
  return Type.Object(properties)
}
