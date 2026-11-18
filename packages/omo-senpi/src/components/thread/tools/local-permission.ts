import { findDiskSessions } from "../address-book"
import type { ThreadToolSurfaceOptions } from "./ports"

export type ThreadPermissionRequest = {
  permission: string
  patterns: string[]
  always: string[]
  autoApproveAsk?: true
}

type LocalityOptions = Pick<ThreadToolSurfaceOptions, "sessionsDirectory">

/**
 * Tools that never change another device: reads (`thread_list`, `thread_read`) and the gateway relay tools (report,
 * outbox, ack, answer). A read may reach the account's other devices through the device service, but it changes nothing
 * there, so reads are exempt from the ask on purpose. `thread_report` and `thread_answer` can post to an external chat
 * the session is bound to: that is the binding the session already has, not another device, so they are exempt too.
 */
const NEVER_CHANGES_ANOTHER_DEVICE: ReadonlySet<string> = new Set([
  "thread_list",
  "thread_read",
  "thread_report",
  "thread_outbox",
  "thread_outbox_ack",
  "thread_answer",
])

const ADDRESSED: ReadonlySet<string> = new Set([
  "thread_send",
  "thread_handoff",
  "thread_interrupt",
  "thread_close",
  "thread_rename",
  "thread_set_model",
  "thread_set_reasoning",
  "thread_archive",
])

/**
 * The permission request of a thread tool call (i22 of the 11/11 desktop QA). The thread tools are eval-only, so a call
 * runs inside an eval cell the permission system has already decided; a nested ask for a call that stays on this device
 * adds an approval per call (an approval storm) and protects nothing the cell does not already run with. Such a call is
 * a request whose `ask` is approved without a prompt, scoped to its target, so `allow` and `deny` rules still decide
 * first. A call that may change another device, or claim an alias in the account-wide registry every device shares
 * (`alias` on `thread_create` or `thread_rename`), keeps the tool-named ask. A target is local only as `self` or as the
 * exact durable id of a session file this device holds: a name or an alias can resolve to another device's thread
 * (the resolver tries account aliases before names), so it always asks.
 */
export function threadToolPermission(name: string, options: LocalityOptions) {
  return (input: Record<string, unknown>): ThreadPermissionRequest[] => {
    const target = localTarget(name, input, options)
    if (target === undefined) return [{ permission: name, patterns: ["*"], always: ["*"] }]
    return [{ permission: name, patterns: [target], always: [target], autoApproveAsk: true }]
  }
}

function localTarget(name: string, input: Record<string, unknown>, options: LocalityOptions): string | undefined {
  if (NEVER_CHANGES_ANOTHER_DEVICE.has(name)) return "*"
  if (input["alias"] !== undefined) return undefined
  if (name === "thread_create") {
    if (input["device"] !== undefined) return undefined
    const sources = [input["thread"], input["fork_from"]].filter((source) => source !== undefined)
    if (sources.length === 0) return "*"
    return sources.every((source) => heldHere(source, options)) ? String(sources[0]) : undefined
  }
  if (ADDRESSED.has(name)) {
    if (name === "thread_handoff" && input["match"] === "fuzzy") return undefined
    const address = input["thread"] ?? "self"
    if (address === "self") return address
    return heldHere(address, options) ? String(address) : undefined
  }
  return undefined
}

function heldHere(address: unknown, options: LocalityOptions): boolean {
  if (typeof address !== "string" || address.length === 0) return false
  const sessionsDirectory = options.sessionsDirectory?.()
  if (sessionsDirectory === undefined) return false
  return findDiskSessions(sessionsDirectory, address, { id_only: true }).length > 0
}
