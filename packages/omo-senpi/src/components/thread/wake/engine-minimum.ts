/**
 * #13037 A8.1: the first engine release whose `release_session` drops a woken session's retained record (senpi#6449,
 * merged at 1ae8fa2863): senpi 2026.11.15-2. 2026.11.15 was cut before that merge. On an older engine a session the
 * carrier handed back is reopened by the host's next restart, so below this version no carrier starts and the delivery
 * consumer makes no wake registration with the device service; null would keep both off on every engine.
 */
export const MIN_WAKE_ENGINE_VERSION: string | null = "2026.11.15-2"

// The engine's version scheme, YYYY.MM.DD-N with optional +build metadata; a release without `-N` orders before `-1`.
const ENGINE_VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-(\d+))?(?:\+.*)?$/

function fieldsOf(version: string): readonly number[] | undefined {
  const match = ENGINE_VERSION.exec(version)
  if (match === null) return undefined
  return [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4] ?? 0)]
}

/**
 * A compiled omo binary stamps its own release version over the engine's (senpi's package version reads "5.1.72"), so
 * there the engine is known by the omo release that pins it: 5.1.72 is the first to pin senpi 2026.11.15-2 or later.
 */
const MIN_WAKE_OMO_VERSION = "5.1.72"

// An omob dev build stamps `0.0.0-omob.<omo commit>.<senpi commit>`: built from a tracked senpi, never a release.
const OMOB_VERSION = /^0\.0\.0-omob\./
const OMO_VERSION = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/

/** Whether `version` is an omo release version (a compiled binary's stamp) rather than senpi's CalVer. */
function omoReleaseFields(version: string): readonly number[] | undefined {
  const match = OMO_VERSION.exec(version)
  if (match === null || Number(match[1]) >= 1000) return undefined
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

const atLeast = (fields: readonly number[], floor: readonly number[]): boolean => {
  for (let index = 0; index < floor.length; index += 1) {
    const field = fields[index] ?? 0
    const bound = floor[index] ?? 0
    if (field !== bound) return field > bound
  }
  return true
}

/** Whether an engine reporting `version` drops the retained record on release. No minimum, or no readable version, is no. */
export function engineDropsRetainedRecord(
  version: string | undefined,
  minimum: string | null = MIN_WAKE_ENGINE_VERSION,
): boolean {
  if (minimum === null || version === undefined) return false
  if (OMOB_VERSION.test(version)) return true
  const omo = omoReleaseFields(version)
  if (omo !== undefined) return atLeast(omo, omoReleaseFields(MIN_WAKE_OMO_VERSION) ?? [])
  const fields = fieldsOf(version)
  const floor = fieldsOf(minimum)
  if (fields === undefined || floor === undefined) return false
  return atLeast(fields, floor)
}
