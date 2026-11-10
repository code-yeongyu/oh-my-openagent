import type { ThreadToolSurfaceOptions } from "./ports"

type PermissionRequest = { permission: string; patterns: string[]; always: string[] }

/**
 * `thread_send`'s permission request (#12886): a reply to an agent whose delivery the caller's current run took in asks
 * for nothing, so a run another agent woke can always answer it; every other send asks for senpi's tool-named fallback.
 */
export function threadSendPermission(options: Pick<ThreadToolSurfaceOptions, "callerReplyTargets">) {
  return (input: Record<string, unknown>): PermissionRequest[] =>
    typeof input["thread"] === "string" && (options.callerReplyTargets?.() ?? []).includes(input["thread"])
      ? []
      : [{ permission: "thread_send", patterns: ["*"], always: ["*"] }]
}
