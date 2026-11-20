import {
  fuzzyMatch,
  resolveTarget,
  workspaceEntries,
  type ThreadAddressEntry,
  type ThreadResolveResult,
} from "../addressing"
import { threadToolFailure } from "../errors"
import { UNKNOWN_CALLER } from "../tools/ports"
import type { Resolution, ResolveContext, ResolveOptions } from "./types"

/** The ladder's answer with the resolution named the way Resolved names it (`self`, `session_id`). */
export type LadderResult =
  | { readonly kind: "ok"; readonly entry: ThreadAddressEntry; readonly resolution: Resolution }
  | Exclude<ThreadResolveResult, { readonly kind: "ok" }>

const named = (text: string, hit: Extract<ThreadResolveResult, { readonly kind: "ok" }>): LadderResult => ({
  kind: "ok",
  entry: hit.entry,
  resolution:
    text === "self" ? "self" : hit.resolution === "id" && hit.entry.thread_id !== text ? "session_id" : hit.resolution,
})

/** `self` -> the caller, then the pure ladder (id, session id, alias, name, id prefix) of addressing.ts. */
function exactLadder(
  ctx: ResolveContext,
  entries: readonly ThreadAddressEntry[],
  text: string,
  opts: ResolveOptions,
): LadderResult {
  let target = text
  if (text === "self") {
    // UNKNOWN_CALLER stands for an ABSENT identity, so it must never match an entry: a thread that happened to carry it
    // as its durable id would otherwise be acted on by any caller whose host passes no execution context.
    const caller =
      ctx.callerId === UNKNOWN_CALLER
        ? undefined
        : (entries.find((entry) => entry.thread_id === ctx.callerId) ??
          entries.find((entry) => entry.session_ids?.includes(ctx.callerId) === true))
    if (caller === undefined)
      return {
        kind: "error",
        ...threadToolFailure(
          "caller_context_missing",
          "The caller's durable session id is not in the thread address book.",
          "Call thread_list (tool.thread_list() in an eval cell) and pass an explicit thread, or retry from a session with caller context.",
        ),
      }
    target = caller.thread_id
  }
  const hit = resolveTarget(entries, target, {
    all_scope: opts.all_scope,
    callerWorkspaceRoot: ctx.callerWorkspaceRoot,
    id_prefix: opts.id_prefix ?? true,
  })
  return hit.kind === "ok" ? named(text, hit) : hit
}

/**
 * The exact ladder, and for a fuzzy hand-off its ranking: exact first (#13141), so fuzzy only ranks what exact cannot
 * reach, the caller excluded as a hand-off never targets its own sender. `ranked` is what fuzzy compares (local, live
 * remote and the ended remote rows that can contend).
 */
export function ladder(
  ctx: ResolveContext,
  entries: readonly ThreadAddressEntry[],
  text: string,
  opts: ResolveOptions,
  ranked: readonly ThreadAddressEntry[] = entries,
): LadderResult {
  const exact = exactLadder(ctx, entries, text, opts)
  if (opts.match !== "fuzzy") return exact
  if (exact.kind === "ok" && exact.entry.thread_id !== ctx.callerId) return exact
  const visible =
    opts.all_scope === true
      ? ranked
      : [
          ...workspaceEntries(
            ranked.filter((entry) => entry.transport === undefined),
            ctx.callerWorkspaceRoot,
          ),
          ...ranked.filter((entry) => entry.transport !== undefined),
        ]
  const found = fuzzyMatch(
    visible.filter((entry) => entry.thread_id !== ctx.callerId),
    text,
  )
  return found.kind === "ok" ? { kind: "ok", entry: found.entry, resolution: "name" } : found
}
