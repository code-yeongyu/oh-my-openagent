/**
 * The first senpi release that accepts both the CLI `--spawned-by` flag and `open_session.spawnedBy`:
 * v2026.10.24-4, the first tag containing senpi#4205 (merge f1933306a0). No host capability names the
 * field, so both launch paths decide from the engine's version.
 */
export const SPAWNED_BY_MIN_ENGINE_VERSION = "2026.10.24-4"

// YYYY.MM.DD-N, optionally followed by +build metadata; a release without `-N` orders before `-1`.
const ENGINE_VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-(\d+))?(?:\+.*)?$/

function versionFields(version: string): readonly number[] | undefined {
  const match = ENGINE_VERSION.exec(version)
  if (match === null) return undefined
  return [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4] ?? 0)]
}

/**
 * Whether an engine reporting `version` accepts spawn ancestry. An absent or unparseable version
 * never does: an engine that cannot prove support must not receive a flag it may reject at boot.
 */
export function engineAcceptsSpawnedBy(version: string | undefined): boolean {
  const fields = version === undefined ? undefined : versionFields(version)
  const minimum = versionFields(SPAWNED_BY_MIN_ENGINE_VERSION)
  if (fields === undefined || minimum === undefined) return false
  for (let index = 0; index < minimum.length; index += 1) {
    const field = fields[index] ?? 0
    const floor = minimum[index] ?? 0
    if (field !== floor) return field > floor
  }
  return true
}
