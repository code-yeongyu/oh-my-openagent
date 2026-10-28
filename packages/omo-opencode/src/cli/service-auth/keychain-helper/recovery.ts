import type { HelperCall, HelperReply } from "./client"

export type MigrationNames = {
  readonly original: boolean
  readonly staging: boolean
  readonly old: boolean
  readonly oldSlots: readonly number[]
}

/** `<A>.old` is slot 0; retired copies rotate through `<A>.old.1` ... `<A>.old.7` (RULING-73). */
export const OLD_SLOT_COUNT = 8
export const oldSlotName = (account: string, slot: number): string => (slot === 0 ? `${account}.old` : `${account}.old.${slot}`)

export type RecoveryStep = "promote" | "remove-staging" | "delete-old"

/**
 * The 3.4 table: what one locked section does for each leftover of an interrupted migration. Renames only, never
 * interactive, and `.old` is never renamed back: an `.old` with no original and no staging means signed out.
 */
export function recoveryPlan(names: MigrationNames): readonly RecoveryStep[] {
  if (!names.original && names.staging) return names.old ? ["promote", "delete-old"] : ["promote"]
  if (!names.original && names.old) return ["delete-old"]
  if (names.original && names.staging) return names.old ? ["remove-staging", "delete-old"] : ["remove-staging"]
  if (names.original && names.old) return ["delete-old"]
  return []
}

/** The names present, from one `read` reply (its `present` field comes from silent attribute reads). */
export function namesFromRead(reply: HelperReply): MigrationNames {
  const original = reply.owned === false || (reply.owned === true && reply.recover !== true)
  return { original, staging: reply.present?.staging === true, old: reply.present?.old === true, oldSlots: reply.present?.oldSlots ?? [] }
}

export type HelperCaller = (call: HelperCall) => Promise<HelperReply>

/**
 * Deletes one retired copy with whichever identity can: the helper when it can read it, otherwise this process's own
 * identity (a decrypt-list member deletes silently, m9). A copy neither can delete is left; it holds a single-use token
 * that the next refresh retires, and it occupies one rotation slot.
 */
export async function deleteOld(name: string, helper: HelperCaller, deleteOwn: (name: string) => Promise<boolean>): Promise<boolean> {
  const removed = await helper({ verb: "remove", account: name }).catch(() => null)
  if (removed?.ok === true) return true
  return deleteOwn(name).catch(() => false)
}

/** Clears every retired slot that is present and that some identity here can delete; true when none is left. */
export async function deleteOldSlots(
  account: string,
  slots: readonly number[],
  helper: HelperCaller,
  deleteOwn: (name: string) => Promise<boolean>,
): Promise<boolean> {
  let cleared = true
  for (const slot of slots) if (!(await deleteOld(oldSlotName(account, slot), helper, deleteOwn))) cleared = false
  return cleared
}

export type RecoveryOutcome = { readonly applied: readonly RecoveryStep[]; readonly failed: RecoveryStep | null }

export async function runRecovery(
  account: string,
  names: MigrationNames,
  helper: HelperCaller,
  deleteOwnOld: (name: string) => Promise<boolean>,
): Promise<RecoveryOutcome> {
  const applied: RecoveryStep[] = []
  for (const step of recoveryPlan(names)) {
    const ok =
      step === "promote"
        ? (await helper({ verb: "promote", account })).ok === true
        : step === "remove-staging"
          ? (await helper({ verb: "remove", account: `${account}.staging` })).ok === true
          : await deleteOldSlots(account, names.oldSlots, helper, deleteOwnOld)
    if (!ok && step !== "delete-old") return { applied, failed: step }
    if (ok) applied.push(step)
  }
  return { applied, failed: null }
}
