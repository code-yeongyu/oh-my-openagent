// The launch classification omo.js's registration half runs before any sidecar loads. It has no sidecar or
// private-fds import, so the compiled-executable fixture imports the same function the loader uses.
//
// It also owns the fallback path's private-descriptor declaration (#12057). When no host CLI captured senpi's table,
// the launcher's SENPI_PRIVATE_FDS / SENPI_PRIVATE_FDS_FINAL are still in process.env at registration, and the
// sidecar's capture removes them only once the claim runs. Registration moves them onto a process global instead,
// so a child another extension spawns before the claim inherits no declaration; the claim's capture module puts them
// back right before senpi's capture reads them (inheritedPrivateChannel.ts). The global is shared because omo.js and
// the sidecar each bundle their own copy of this module.

const SENPI_CAPTURE = Symbol.for("senpi.private-fds.v3")
const DEFERRED = Symbol.for("omo.memory-sync.deferred-private-fds.v1")
const TABLE_ENV = "SENPI_PRIVATE_FDS"
const FINAL_ENV = "SENPI_PRIVATE_FDS_FINAL"

type DeferredDeclaration = { readonly table: string; readonly final: string | undefined; restored: boolean }

const deferredDeclaration = (): DeferredDeclaration | undefined => Reflect.get(globalThis, DEFERRED)

/**
 * Whether the launch carried a private-descriptor table at all (a declared memory-sync implies one): senpi's captured
 * table when its CLI captured it, else the launcher's table, deferred off the env or still in it.
 */
export function launchCarriedPrivateTable(): boolean {
  if (deferredDeclaration() !== undefined) return true
  const table = (globalThis as { [key: symbol]: { readonly present?: unknown } | undefined })[SENPI_CAPTURE]
  return table ? table.present === true : Boolean(process.env[TABLE_ENV])
}

/** Main thread, at registration: on the fallback path, take the declaration out of process.env synchronously. */
export function deferUncapturedPrivateFdDeclaration(): void {
  if (Reflect.get(globalThis, SENPI_CAPTURE) !== undefined || deferredDeclaration() !== undefined) return
  const table = process.env[TABLE_ENV]
  if (!table) return
  const declaration: DeferredDeclaration = { table, final: process.env[FINAL_ENV], restored: false }
  Reflect.set(globalThis, DEFERRED, declaration)
  delete process.env[TABLE_ENV]
  delete process.env[FINAL_ENV]
}

/**
 * Puts a deferred declaration back once, for the capture that evaluates right after. A capture that already ran
 * (another copy, in between) read no table: the declaration stays out of the env and the claim answers unavailable,
 * while the launch still classifies as carrying a table.
 */
export function restoreDeferredPrivateFdDeclaration(): void {
  const declaration = deferredDeclaration()
  if (declaration === undefined || declaration.restored) return
  declaration.restored = true
  if (Reflect.get(globalThis, SENPI_CAPTURE) !== undefined) return
  process.env[TABLE_ENV] = declaration.table
  if (declaration.final !== undefined) process.env[FINAL_ENV] = declaration.final
}
