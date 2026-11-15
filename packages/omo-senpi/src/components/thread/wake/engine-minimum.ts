/**
 * #13037 A8.1: the first engine release whose `release_session` drops a woken session's retained record (senpi#6449).
 * On an older engine a session the carrier handed back is reopened by the host's next restart, so the delivery consumer
 * makes no wake registration with the device service below this version. senpi#6449 is not released yet: null keeps the
 * consumer off on every engine until that release is cut and named here.
 */
export const MIN_WAKE_ENGINE_VERSION: string | null = null

// The engine's version scheme, YYYY.MM.DD-N with optional +build metadata; a release without `-N` orders before `-1`.
const ENGINE_VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-(\d+))?(?:\+.*)?$/

function fieldsOf(version: string): readonly number[] | undefined {
  const match = ENGINE_VERSION.exec(version)
  if (match === null) return undefined
  return [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4] ?? 0)]
}

/** Whether an engine reporting `version` drops the retained record on release. No minimum, or no readable version, is no. */
export function engineDropsRetainedRecord(
  version: string | undefined,
  minimum: string | null = MIN_WAKE_ENGINE_VERSION,
): boolean {
  const fields = version === undefined ? undefined : fieldsOf(version)
  const floor = minimum === null ? undefined : fieldsOf(minimum)
  if (fields === undefined || floor === undefined) return false
  for (let index = 0; index < floor.length; index += 1) {
    const field = fields[index] ?? 0
    const bound = floor[index] ?? 0
    if (field !== bound) return field > bound
  }
  return true
}
