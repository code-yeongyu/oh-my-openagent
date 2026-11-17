import { findDiskSessions } from "../address-book"
import { workspaceDirectories } from "../addressing"
import type { ThreadToolSurfaceOptions } from "./ports"

export type ThreadPermissionRequest = {
  permission: string
  patterns: string[]
  always: string[]
  autoApproveAsk?: true
}

type LocalityOptions = Pick<ThreadToolSurfaceOptions, "sessionsDirectory" | "callerWorkspaceRoot">

/** Tools that only read, or only touch this device's gateway store: no call of theirs acts on another device. */
const ALWAYS_LOCAL: ReadonlySet<string> = new Set([
  "thread_list",
  "thread_read",
  "thread_report",
  "thread_outbox",
  "thread_outbox_ack",
  "thread_answer",
])

/** Tools whose `thread` names the session they act on; absent means the caller itself. */
const ADDRESSED: ReadonlySet<string> = new Set([
  "thread_send",
  "thread_handoff",
  "thread_interrupt",
  "thread_close",
  "thread_rename",
  "thread_set_model",
  "thread_set_reasoning",
])

/**
 * The permission request of a thread tool call (i22 of the 11/11 desktop QA). The thread tools are eval-only, so a call
 * runs inside an eval cell the permission system has already decided; a nested ask for a call that stays on this device
 * adds an approval per call (an approval storm) and protects nothing the cell does not already run with. Such a call is
 * a request whose `ask` is approved without a prompt, scoped to its target, so `allow` and `deny` rules still decide
 * first. A call that names another device, or a session this device does not hold, keeps the tool-named ask.
 */
export function threadToolPermission(name: string, options: LocalityOptions) {
  return (input: Record<string, unknown>): ThreadPermissionRequest[] => {
    const target = localTarget(name, input, options)
    if (target === undefined) return [{ permission: name, patterns: ["*"], always: ["*"] }]
    return [{ permission: name, patterns: [target], always: [target], autoApproveAsk: true }]
  }
}

function localTarget(name: string, input: Record<string, unknown>, options: LocalityOptions): string | undefined {
  if (ALWAYS_LOCAL.has(name)) return "*"
  if (name === "thread_create") {
    if (input["device"] !== undefined) return undefined
    const existing = input["thread"]
    return existing === undefined ? "*" : addressedTarget(existing, input, options)
  }
  if (ADDRESSED.has(name)) {
    if (name === "thread_handoff" && input["match"] === "fuzzy") return undefined
    return addressedTarget(input["thread"] ?? "self", input, options)
  }
  return undefined
}

function addressedTarget(
  address: unknown,
  input: Record<string, unknown>,
  options: LocalityOptions,
): string | undefined {
  if (typeof address !== "string" || address.length === 0) return undefined
  if (address === "self") return address
  const sessionsDirectory = options.sessionsDirectory?.()
  if (sessionsDirectory === undefined) return undefined
  const found = findDiskSessions(sessionsDirectory, address, {
    all_scope: input["all_scope"] === true,
    workspaceRoots: workspaceDirectories(options.callerWorkspaceRoot()),
  })
  return found.length > 0 ? address : undefined
}
