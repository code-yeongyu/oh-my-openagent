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
 * there the engine is known by the omo release that pins it: 5.1.72 is the first to pin senpi 2026.11.15-2 or later. This
 * floor stands for MIN_WAKE_ENGINE_VERSION only; it says nothing about any other engine minimum.
 */
const MIN_WAKE_OMO_VERSION = "5.1.72"

// An omob dev build stamps `0.0.0-omob.<omo commit>.<senpi commit>`: built from a tracked senpi, never a release.
const OMOB_VERSION = /^0\.0\.0-omob\./
const OMO_VERSION = /^(\d+)\.(\d+)\.(\d+)(-[^+]*)?(?:\+.*)?$/

/**
 * Whether `version` is an omo release version (a compiled binary's stamp) rather than senpi's CalVer. A prerelease
 * (`5.1.72-beta.1`) orders before its release, as semver orders it, so the last field is -1 for one and 0 otherwise.
 */
function omoReleaseFields(version: string): readonly number[] | undefined {
  const match = OMO_VERSION.exec(version)
  if (match === null || Number(match[1]) >= 1000) return undefined
  return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] === undefined ? 0 : -1]
}

const atLeast = (fields: readonly number[], floor: readonly number[]): boolean => {
  for (let index = 0; index < floor.length; index += 1) {
    const field = fields[index] ?? 0
    const bound = floor[index] ?? 0
    if (field !== bound) return field > bound
  }
  return true
}

/**
 * Whether an engine reporting `version` drops the retained record on release. No minimum, or no readable version, is no.
 * An omo stamp (a compiled release or an omob dev build) names no senpi CalVer, so it is judged only against the shipped
 * minimum it was mapped to (MIN_WAKE_OMO_VERSION); under any other minimum it cannot be shown to meet it and is no.
 */
export function engineDropsRetainedRecord(
  version: string | undefined,
  minimum: string | null = MIN_WAKE_ENGINE_VERSION,
): boolean {
  if (minimum === null || version === undefined) return false
  const omob = OMOB_VERSION.test(version)
  const omo = omob ? undefined : omoReleaseFields(version)
  if (omob || omo !== undefined) {
    if (minimum !== MIN_WAKE_ENGINE_VERSION) return false
    return omob || atLeast(omo ?? [], omoReleaseFields(MIN_WAKE_OMO_VERSION) ?? [])
  }
  const fields = fieldsOf(version)
  const floor = fieldsOf(minimum)
  if (fields === undefined || floor === undefined) return false
  return atLeast(fields, floor)
}
