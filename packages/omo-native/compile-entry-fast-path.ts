/**
 * The argv the engine answers from local data alone (#10760, #10771): `--version` / `-v`, printed from
 * the embedded manifest. These never read the OS certificate store. `omo update` is answered locally
 * only for its hint; a release build's real self-update fetches GitHub releases, so it needs trust and
 * is not part of this set. One predicate, shared by the fast path and the trust gate.
 */
export function answeredFromLocalData(args: readonly string[]): boolean {
  return args.length === 1 && (args[0] === "--version" || args[0] === "-v")
}
