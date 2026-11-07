// The launch classification omo.js's registration half runs before any sidecar loads. It has no sidecar or
// private-fds import, so the compiled-executable fixture imports the same function the loader uses.

/**
 * Whether the launch carried a private-descriptor table at all (a declared memory-sync implies one): senpi's captured
 * table when its CLI captured it, else the launcher's table still in this process's env, which the claim then captures.
 */
export function launchCarriedPrivateTable(): boolean {
  const table = (globalThis as { [key: symbol]: { readonly present?: unknown } | undefined })[Symbol.for("senpi.private-fds.v3")]
  return table ? table.present === true : Boolean(process.env.SENPI_PRIVATE_FDS)
}
