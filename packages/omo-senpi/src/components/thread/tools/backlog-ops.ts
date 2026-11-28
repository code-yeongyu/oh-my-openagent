import { createHash } from "node:crypto"

import { normalizeThreadName } from "../addressing"
import { THREAD_STATES } from "../contracts"
import { threadToolFailure, type ThreadToolFailure } from "../errors"
import type { BacklogTransferAnswer } from "../gateway/store-backlog-transfer"
import type { ThreadHostView, ThreadToolSurfaceOptions } from "./ports"
import { listThreads } from "./read-ops"

/** omo#15187: what the SDK's `backlog` takes. Every session is named by its durable id: a name is shared after a takeover. */
export type BacklogRequest = {
  readonly thread: string
  /** The session the call acts for: it holds `thread`'s registered name, or created `thread`. */
  readonly caller: string
  readonly action: "cancel" | "move"
  /** With `move`: the session the lines are queued on, in order. */
  readonly destination?: string
  readonly idempotency_key: string
}

export type BacklogResult =
  | ({ readonly kind: "ok"; readonly thread: string; readonly deduplicated: boolean } & BacklogTransferAnswer)
  | { readonly kind: "error"; readonly error: ThreadToolFailure }

export const BACKLOG_KEYS = ["thread", "caller", "action", "destination", "idempotency_key"] as const

const fail = (...args: Parameters<typeof threadToolFailure>): BacklogResult => ({
  kind: "error",
  error: threadToolFailure(...args),
})

function invalid(request: BacklogRequest): BacklogResult | undefined {
  const named = (value: unknown) => typeof value === "string" && value.length > 0
  if (!named(request.thread) || !named(request.caller) || !named(request.idempotency_key))
    return fail(
      "invalid_arguments",
      "thread, caller and idempotency_key are required.",
      "Pass each as a non-empty string.",
    )
  if (request.action !== "cancel" && request.action !== "move")
    return fail("invalid_arguments", `Unknown action ${String(request.action)}.`, 'Pass action "cancel" or "move".')
  if (request.action === "cancel" && request.destination !== undefined)
    return fail("invalid_arguments", "A cancel takes no destination.", "Drop destination, or use action move.")
  if (request.action === "move" && (!named(request.destination) || request.destination === request.thread))
    return fail(
      "invalid_arguments",
      "A move needs a destination other than the thread itself.",
      "Pass the destination session's id.",
    )
  return undefined
}

/**
 * Cancels or moves the pending deliveries of `thread` on this device, through the gateway store only: the session is
 * never loaded or woken. A target that is loaded and mid-turn is refused `turn_active` with nothing changed.
 */
export async function transferBacklog(
  options: ThreadToolSurfaceOptions,
  current: ThreadHostView,
  principal: string,
  request: BacklogRequest,
): Promise<BacklogResult> {
  const refused = invalid(request)
  if (refused !== undefined) return refused
  const listed = listThreads(options, current, true, THREAD_STATES)
  if (listed.kind !== "ok" || !("threads" in listed)) return listed as BacklogResult
  const rowOf = (id: string) => listed.threads.find((row) => row.thread === id)
  const destination = request.action === "move" ? (request.destination ?? null) : null
  for (const id of [request.thread, request.caller, ...(destination === null ? [] : [destination])])
    if (rowOf(id) === undefined)
      return fail("not_found", `No session ${id} on this device.`, "Run omo thread list --all-scope for the ids.", {
        thread: id,
      })
  const source = rowOf(request.thread)
  const caller = rowOf(request.caller)
  if (source === undefined || caller === undefined) return fail("internal_error", "The listing changed.", "Retry.")
  const outcome = await options.store.transferBacklog({
    now: options.now?.() ?? Date.now(),
    principal,
    idempotency_key: request.idempotency_key,
    args_hash: createHash("sha256")
      .update(JSON.stringify([request.thread, request.caller, request.action, destination]))
      .digest("hex"),
    source: request.thread,
    action: request.action,
    destination,
    caller: request.caller,
    caller_holds_name:
      caller.thread !== source.thread &&
      source.unnamed !== true &&
      caller.unnamed !== true &&
      normalizeThreadName(caller.name) === normalizeThreadName(source.name),
    source_running: source.state === "running" || source.state === "opening",
  })
  if (outcome.kind === "done")
    return { kind: "ok", thread: request.thread, ...outcome.answer, deduplicated: outcome.replayed }
  if (outcome.reason === "idempotency_conflict")
    return fail(
      "idempotency_conflict",
      "The idempotency key was already used with different arguments.",
      "Use a new idempotency_key.",
    )
  if (outcome.reason === "turn_active")
    return fail(
      "turn_active",
      `Thread ${request.thread} is loaded and mid-turn; its pending deliveries were left as they are.`,
      "Retry once its turn ends, or close it first.",
      { thread: request.thread, state: source.state },
    )
  return fail(
    "scope_denied",
    `Session ${request.caller} neither holds the registered name of ${request.thread} nor created it.`,
    "Call as the session that holds the name now, or as the one that created it.",
    { thread: request.thread, caller: request.caller, reason: "not_name_holder" },
  )
}
