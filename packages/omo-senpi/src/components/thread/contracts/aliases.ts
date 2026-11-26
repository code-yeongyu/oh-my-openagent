/**
 * Field names a thread tool accepts in place of its own, each naming the same thing (#15073). The census of refused
 * calls across the fleet found agents reaching for the names the core tools and the other thread tools use: `limit` on
 * thread_read like `read`, `mode` on thread_send like the thread SDK, `thinking` on thread_create. Each alias is
 * rewritten to its field before validation; an alias given together with its field and a different value is refused,
 * so an alias is never dropped silently. A required field has no alias: the host validates the declared schema before
 * the tool runs, so a call without the field never reaches this map, and the SDK calls keep that field required.
 */
export const THREAD_PARAM_ALIASES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  thread_create: {
    message: "prompt",
    title: "name",
    mode: "delivery",
    thinking: "reasoning",
    thinking_level: "reasoning",
  },
  thread_list: { search: "query" },
  thread_read: {
    tail: "limit",
    lines: "limit",
    count: "limit",
    last: "limit",
    limit_bytes: "max_bytes",
    bytes: "max_bytes",
  },
  thread_send: { mode: "delivery" },
  thread_handoff: { mode: "delivery" },
  thread_rename: { title: "name" },
}

const WAIT_FOR_REPLY =
  "It returns once the message is delivered or queued and never waits for the reply; to wait for the answer, call thread_read with wait_ms."

/** A field a tool has no counterpart for, with the one line that names the call that does the job. */
export const THREAD_PARAM_NOTES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  thread_send: { timeout: WAIT_FOR_REPLY, wait: WAIT_FOR_REPLY, wait_ms: WAIT_FOR_REPLY },
  thread_handoff: { timeout: WAIT_FOR_REPLY, wait: WAIT_FOR_REPLY, wait_ms: WAIT_FOR_REPLY },
  thread_read: {
    mode: "thread_read always returns the newest messages (limit sets how many); thread_list shows each thread's state.",
    query:
      "thread_read does not search; read with limit and search the returned text, or find the thread with thread_list query.",
  },
}
