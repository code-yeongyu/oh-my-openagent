import type { HelperAccess } from "./access"
import type { ApprovalAnswer, ApprovalCache } from "./approval-cache"
import type { HelperReply } from "./client"

export type ReadSource = "owned" | "owned-unmarked" | "own-identity" | "approved"
export type ReadResult =
  | { readonly kind: "value"; readonly value: string; readonly source: ReadSource; readonly reply: HelperReply }
  | { readonly kind: "missing"; readonly reply: HelperReply }

/**
 * Row 8b (addendum, PRODUCT CALL, recommended default): the item's creator is gone and the only dialog left would be
 * the login-password kind. "re-login" reads as signed out so the user signs in again (save then retires the old item);
 * "password-dialog" asks anyway. Only the default may ship until the owner decides.
 */
export type Row8bChoice = "re-login" | "password-dialog"
export const ROW_8B_DEFAULT: Row8bChoice = "re-login"

export type ReadFailure = "locked" | "store" | "pending" | "denied"
export class HelperReadError extends Error {
  constructor(
    readonly failure: ReadFailure,
    message: string,
  ) {
    super(message)
  }
}

export type DarwinReadDeps = {
  readonly account: string
  readonly access: Extract<HelperAccess, { kind: "ready" }>
  /** This process's own identity, interaction off: the value, null when missing, or throws when refused. */
  readonly ownSilentGet: () => Promise<string | null>
  readonly cache: ApprovalCache
  /** R4: the machine-wide prompt lock, taken with zero wait; null when another process holds it. */
  readonly takePromptLock: () => Promise<(() => Promise<void>) | null>
  /** Asks the side that created the item to migrate it before any prompt; true when that ran. */
  readonly handOff?: () => Promise<boolean>
  readonly noDialog?: boolean
  readonly background: boolean
  readonly row8b?: Row8bChoice
}

function failure(reply: HelperReply): HelperReadError {
  if (reply.error === "locked") return new HelperReadError("locked", "The keychain is locked.")
  return new HelperReadError("store", `The keychain helper answered ${reply.error ?? "unexpectedly"}.`)
}

async function approveOnce(deps: DarwinReadDeps): Promise<ApprovalAnswer> {
  // Rows 12, 13: a reader in this process attaches to the approve already running here, whichever backend started it.
  const running = deps.cache.inFlight()
  if (running !== null) return running
  const release = await deps.takePromptLock()
  if (release === null) throw new HelperReadError("pending", "Another omo process is waiting for your keychain approval.")
  try {
    return await deps.cache.approve(async () => {
      const reply = await deps.access.call({ verb: "approve", account: deps.account })
      if (reply.missing === true) return { kind: "missing" }
      if (reply.error === "denied") return { kind: "denied" }
      if (reply.error !== undefined || reply.value === undefined || reply.cdat === undefined || reply.mdat === undefined) throw failure(reply)
      return { kind: "approved", value: reply.value, attributes: { cdat: reply.cdat, mdat: reply.mdat } }
    })
  } finally {
    await release()
  }
}

/**
 * Design 3.2 for one read: the helper's read; for an item another identity owns, this process's own silent read, then
 * the process's validated approval, then (outside the session lock only) the creator hand-off and at most one plain
 * `approve` dialog. A login-password dialog is never shown (addendum Q2): such an item reads per row 8b.
 */
export async function readThroughHelper(deps: DarwinReadDeps, allowPrompt: boolean): Promise<ReadResult> {
  const reply = await deps.access.call({ verb: "read", account: deps.account })
  if (reply.error !== undefined) throw failure(reply)
  if (reply.missing === true) return { kind: "missing", reply }
  if (reply.owned === true && reply.value !== undefined)
    return { kind: "value", value: reply.value, source: reply.marker === true || reply.recover === true ? "owned" : "owned-unmarked", reply }

  const own = await deps.ownSilentGet().catch(() => undefined)
  if (typeof own === "string") return { kind: "value", value: own, source: "own-identity", reply }
  if (reply.cdat === undefined || reply.mdat === undefined) throw failure(reply)
  const cached = deps.cache.consume({ cdat: reply.cdat, mdat: reply.mdat })
  if (cached !== null) return { kind: "value", value: cached, source: "approved", reply }

  const reloginInstead = reply.partition !== "ours" && reply.partition !== "none" && (deps.row8b ?? ROW_8B_DEFAULT) === "re-login"
  if (!allowPrompt) {
    if (reloginInstead) return { kind: "missing", reply }
    throw new HelperReadError("pending", "The keychain needs your approval; run an omo command in a terminal.")
  }
  if (deps.background && deps.cache.deniedForBackground())
    throw new HelperReadError("pending", "Keychain access was denied; run an omo command in a terminal to approve it.")
  if (reloginInstead) return { kind: "missing", reply }
  // A hand-off child exists only to move the item silently; it never shows a dialog of its own (one dialog in total).
  if (deps.noDialog === true) throw new HelperReadError("pending", "The keychain hand-off cannot show a dialog.")
  // Only here, where this process would otherwise show its one dialog, ask the item's creator to move it first.
  if (deps.handOff !== undefined && (await deps.handOff())) {
    const after = await deps.access.call({ verb: "read", account: deps.account })
    if (after.owned === true && after.value !== undefined) return { kind: "value", value: after.value, source: "owned", reply: after }
  }
  const answer = await approveOnce(deps)
  if (answer.kind === "approved") return { kind: "value", value: answer.value, source: "approved", reply }
  if (answer.kind === "missing") return { kind: "missing", reply }
  throw new HelperReadError("denied", "Keychain access was denied.")
}
