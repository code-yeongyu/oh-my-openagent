import type { ThreadToolSurfaceOptions } from "./ports"
import { normalizeThreadName } from "../addressing"

type PermissionRequest = { permission: string; patterns: string[]; always: string[]; autoApproveAsk?: true }

/** A durable session id: the only spelling of a reply target that resolves exactly, never through an alias or a name. */
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * `thread_send`'s permission request (#12886). A reply to an agent whose delivery the caller's current run took in, named
 * by its exact session id, is a request scoped to that session whose `ask` is approved without a prompt, so a run another
 * agent woke can always answer it while `allow` and `deny` rules still decide first. Every other send asks for senpi's
 * tool-named fallback.
 */
export function threadSendPermission(
  options: Pick<ThreadToolSurfaceOptions, "callerReplyTargets" | "callerReplySenders">,
) {
  return (input: Record<string, unknown>): PermissionRequest[] => {
    const target = input["thread"]
    if (typeof target === "string" && isReplyToConsumedSender(options, target))
      return [{ permission: "thread_send", patterns: [target], always: [target], autoApproveAsk: true }]
    return [{ permission: "thread_send", patterns: ["*"], always: ["*"] }]
  }
}

/**
 * Decision 0027 section 6: the reply allowance is decided from the consumed delivery itself - its sender's durable id or
 * the name it stated - never from a listing. The send step then delivers only when the address resolves to that sender
 * (`replyTargetMismatch` in tools.ts), so a name that happens to match another session is never reached unapproved.
 */
export function isReplyToConsumedSender(
  options: Pick<ThreadToolSurfaceOptions, "callerReplyTargets" | "callerReplySenders">,
  target: string,
): boolean {
  if (SESSION_ID.test(target) && (options.callerReplyTargets?.() ?? []).includes(target)) return true
  const wanted = normalizeThreadName(target)
  return (options.callerReplySenders?.() ?? []).some(
    (sender) =>
      sender.session_id === target ||
      (sender.name !== undefined && wanted !== "" && normalizeThreadName(sender.name) === wanted),
  )
}
