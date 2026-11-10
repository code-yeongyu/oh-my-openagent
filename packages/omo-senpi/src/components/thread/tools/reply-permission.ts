import type { ThreadToolSurfaceOptions } from "./ports"

type PermissionRequest = { permission: string; patterns: string[]; always: string[]; autoApproveAsk?: true }

/** A durable session id: the only spelling of a reply target that resolves exactly, never through an alias or a name. */
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * `thread_send`'s permission request (#12886). A reply to an agent whose delivery the caller's current run took in, named
 * by its exact session id, is a request scoped to that session whose `ask` is approved without a prompt, so a run another
 * agent woke can always answer it while `allow` and `deny` rules still decide first. Every other send asks for senpi's
 * tool-named fallback.
 */
export function threadSendPermission(options: Pick<ThreadToolSurfaceOptions, "callerReplyTargets">) {
  return (input: Record<string, unknown>): PermissionRequest[] => {
    const target = input["thread"]
    if (typeof target === "string" && SESSION_ID.test(target) && (options.callerReplyTargets?.() ?? []).includes(target))
      return [{ permission: "thread_send", patterns: [target], always: [target], autoApproveAsk: true }]
    return [{ permission: "thread_send", patterns: ["*"], always: ["*"] }]
  }
}
