import { deleteOld, type HelperCaller } from "./recovery"

/** Where the value about to be migrated came from; anything else is never migrated (3.3 table, addendum row 22). */
export type MigrationSource = "own-identity" | "owned-unmarked" | "approved"
const MIGRATABLE: ReadonlySet<string> = new Set<MigrationSource>(["own-identity", "owned-unmarked", "approved"])

export type MigrationOutcome =
  | { readonly kind: "migrated"; readonly oldDeleted: boolean }
  | { readonly kind: "skipped"; readonly reason: "old-exists" | "not-migratable" }
  | { readonly kind: "failed"; readonly step: "stage" | "retire" | "promote" }

/**
 * stage -> retire (`<A>` -> `<A>.old`) -> promote (staging -> `<A>`) -> delete `.old`, all helper calls under the
 * session lock (3.6 R2), so at every instant `<A>`, `<A>.staging` or `<A>.old` holds the current value. It never throws
 * for a keychain refusal: the caller prints one notice and its section continues with the value it already read; 3.4
 * recovery converges whatever is left.
 */
export async function migrate(
  account: string,
  value: string,
  source: string,
  helper: HelperCaller,
  deleteOwnOld: () => Promise<boolean>,
): Promise<MigrationOutcome> {
  if (!MIGRATABLE.has(source)) return { kind: "skipped", reason: "not-migratable" }
  if ((await helper({ verb: "stage", account, value })).ok !== true) return { kind: "failed", step: "stage" }
  const retired = await helper({ verb: "retire", account })
  if (retired.skipped === true) {
    await helper({ verb: "remove", account: `${account}.staging` })
    return { kind: "skipped", reason: "old-exists" }
  }
  if (retired.ok !== true) return { kind: "failed", step: "retire" }
  if ((await helper({ verb: "promote", account })).ok !== true) return { kind: "failed", step: "promote" }
  return { kind: "migrated", oldDeleted: await deleteOld(account, helper, deleteOwnOld) }
}
