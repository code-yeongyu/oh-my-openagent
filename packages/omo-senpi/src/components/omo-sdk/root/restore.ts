// Design 4.4 and the design lane's ruling on review 6064490103: what the root's failure shape cannot hold of a core's
// failure (a code the registry lacks, a field beyond the shape, whether details existed, the original key order) rides
// in ONE reserved details key that no producer's failure may carry, so the inverse rebuilds the original exactly, key
// order included, since `omo thread --json` prints it.

export const RESTORE_KEY = "$restore"

type Details = Readonly<Record<string, unknown>>

export type Restore = {
  /** The original code when the registry lacks it. */
  readonly code?: string
  readonly details: boolean
  /** Fields of the original failure beyond the root's shape. */
  readonly extra?: Readonly<Record<string, unknown>>
  readonly keys: readonly string[]
}

export const carriesReservedKey = (details: Details | undefined): boolean =>
  details !== undefined && Object.hasOwn(details, RESTORE_KEY)

export function restoreOf(details: Details | undefined): Restore | undefined {
  const restore = details?.[RESTORE_KEY] as Partial<Restore> | undefined
  if (typeof restore?.details !== "boolean" || !Array.isArray(restore.keys)) return undefined
  return restore as Restore
}

/** The details of a converted failure: the original details plus, when anything must be restored, the reserved key. */
export function withRestore(
  original: Readonly<Record<string, unknown>>,
  shape: readonly string[],
  held: string | undefined,
): Details | undefined {
  const details = original["details"] as Details | undefined
  const extraKeys = Object.keys(original).filter((key) => !shape.includes(key))
  if (held === undefined && extraKeys.length === 0) return details
  const restore: Restore = {
    ...(held === undefined ? {} : { code: held }),
    details: details !== undefined,
    ...(extraKeys.length === 0 ? {} : { extra: Object.fromEntries(extraKeys.map((key) => [key, original[key]])) }),
    keys: Object.keys(original),
  }
  return { ...details, [RESTORE_KEY]: restore }
}

/** The original failure: the converted fields, the reserved key's extras, in the original key order. */
export function restored(
  fields: Readonly<Record<string, unknown>>,
  restore: Restore | undefined,
): Readonly<Record<string, unknown>> {
  if (restore === undefined) return fields
  const { [RESTORE_KEY]: _restore, ...details } = (fields["details"] as Details | undefined) ?? {}
  const values: Record<string, unknown> = {
    ...fields,
    ...(restore.code === undefined ? {} : { code: restore.code }),
    ...restore.extra,
    details,
  }
  return Object.fromEntries(
    restore.keys.filter((key) => key !== "details" || restore.details).map((key) => [key, values[key]]),
  )
}
