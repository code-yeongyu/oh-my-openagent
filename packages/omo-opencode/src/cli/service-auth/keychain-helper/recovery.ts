import type { HelperCall, HelperReply } from "./client"

export type MigrationNames = { readonly original: boolean; readonly staging: boolean; readonly old: boolean }

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
  return { original, staging: reply.present?.staging === true, old: reply.present?.old === true }
}

export type HelperCaller = (call: HelperCall) => Promise<HelperReply>

/**
 * Deletes `<A>.old` with whichever identity can: the helper when it can read it, otherwise this process's own
 * identity (a decrypt-list member deletes silently, m9). A copy neither can delete is left; it holds a single-use token
 * that the next refresh retires.
 */
export async function deleteOld(account: string, helper: HelperCaller, deleteOwn: () => Promise<boolean>): Promise<boolean> {
  const removed = await helper({ verb: "remove", account: `${account}.old` }).catch(() => null)
  if (removed?.ok === true) return true
  return deleteOwn().catch(() => false)
}

export type RecoveryOutcome = { readonly applied: readonly RecoveryStep[]; readonly failed: RecoveryStep | null }

export async function runRecovery(
  account: string,
  names: MigrationNames,
  helper: HelperCaller,
  deleteOwnOld: () => Promise<boolean>,
): Promise<RecoveryOutcome> {
  const applied: RecoveryStep[] = []
  for (const step of recoveryPlan(names)) {
    const ok =
      step === "promote"
        ? (await helper({ verb: "promote", account })).ok === true
        : step === "remove-staging"
          ? (await helper({ verb: "remove", account: `${account}.staging` })).ok === true
          : await deleteOld(account, helper, deleteOwnOld)
    if (!ok && step !== "delete-old") return { applied, failed: step }
    if (ok) applied.push(step)
  }
  return { applied, failed: null }
}
