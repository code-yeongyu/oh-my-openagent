import { normalizeThreadName } from "../addressing"
import type { ThreadRenameInput, ThreadToolResult } from "../contracts"
import type { LocalAliasReason } from "../remote/cross-device"
import { renameAlias } from "../remote/lazy-ops"
import { failure } from "../tools/internals"
import type { ThreadHostView, ThreadToolSurfaceOptions } from "../tools/ports"
import { locateControl } from "./locate"
import { NOT_LIVE } from "./operations"
import { controlIdentity } from "./port"

/**
 * The one rename body (thread_rename and the SDK): every refusal runs before the alias or the name changes anywhere - the
 * target's own liveness first (a thread with no live owner, a device that is offline), then the name checks - and only
 * then the alias, then the name. `key` is the alias registry's idempotency key. It lives apart from control/operations.ts
 * because the local-only `omo remote` verbs import that module, and locating a thread must stay out of their graph.
 */
export async function renameThread(
  options: ThreadToolSurfaceOptions,
  current: ThreadHostView,
  value: ThreadRenameInput,
  key: string,
  callerId: string,
): Promise<ThreadToolResult> {
  if (value.name === undefined && value.alias === undefined)
    return failure("invalid_arguments", "Pass a new name, a new alias, or both.", "Retry with name or alias.")
  const located = await locateControl(options, current, value.thread ?? "self", value.all_scope, callerId)
  if (located.kind === "error") return located.result
  const thread = located.kind === "control" ? located.control : located
  // #13066: the name is checked on the target device's own listing, and only when a live owner holds the thread.
  const nameRefusal = async (name: string): Promise<ThreadToolResult | undefined> => {
    if (located.kind === "not_live") return NOT_LIVE
    if (located.kind !== "control") return undefined
    if (name.length === 0)
      return failure("invalid_arguments", "The new thread name is empty.", "Pass a non-empty name.")
    const visible = await located.control.visible()
    const existing = visible.find(
      (entry) => entry.thread_id !== thread.thread_id && normalizeThreadName(entry.name) === normalizeThreadName(name),
    )
    return existing === undefined
      ? undefined
      : failure(
          "name_conflict",
          `A thread named "${existing.name}" already exists.`,
          "Call thread_list (tool.thread_list() in an eval cell) and choose another name.",
        )
  }
  let name = value.name?.trim()
  const refusedName = name === undefined ? undefined : await nameRefusal(name)
  if (refusedName !== undefined) return refusedName
  let localAlias: LocalAliasReason | undefined
  if (value.alias !== undefined) {
    const refused = await renameAlias(options.remote, thread.thread_id, thread.device, value.alias, key)
    if (refused !== undefined && "local" in refused) {
      // No account holds the alias and nothing changed (#13104): it becomes the thread's name unless one was given.
      localAlias = refused.local
      if (name === undefined) {
        name = value.alias.trim()
        const refusedAlias = await nameRefusal(name)
        if (refusedAlias !== undefined) return refusedAlias
      }
    } else if (refused !== undefined) return refused
  }
  if (name !== undefined && located.kind === "control") await located.control.setName(name)
  const aliasFields =
    value.alias === undefined
      ? {}
      : localAlias === undefined
        ? { alias: value.alias }
        : { alias_scope: "local" as const, alias_unavailable: localAlias }
  return { kind: "ok", ...controlIdentity(thread), name: name ?? thread.title, ...aliasFields }
}
