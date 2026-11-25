// Design 4.4: an exit code is a projection of a failure, keyed by the surface that prints it, never one table. Each
// surface is data in its own file, under the CLI entry string of the rows it prints for (a slice adds its surface's file
// and its keys in SURFACE_EXITS); this module only reads them. A success exits `ok` unless one of the surface's
// `okRules` matches its result by equality over top-level fields; a slice that needs a summary of a result puts a typed
// summary field in it (a reap's `complete`), never a quantifier or an expression here.

type Failure = { readonly code: string; readonly details?: Readonly<Record<string, unknown>> }

/** One rule: the failure's code, optionally values its details must hold, and the exit it maps to. */
export type ExitRule =
  | { readonly code: string; readonly details?: Readonly<Record<string, unknown>>; readonly exit: number }
  /** The exit is the failure's own details field (a child process's status passed through), when it is 1 to 255. */
  | { readonly code: string; readonly details?: Readonly<Record<string, unknown>>; readonly exitFrom: string }

/** A success rule: values the result's top-level fields must all equal, and the exit it maps to. */
export type OkRule = { readonly result: Readonly<Record<string, unknown>>; readonly exit: number }

/** What a call answered: its result, or its failure. */
export type Answer =
  { readonly kind: "ok"; readonly value?: unknown } | { readonly kind: "error"; readonly error: Failure }

export type SurfaceExits = {
  readonly ok: number
  /** First match wins over a success's result; none matching exits `ok`. */
  readonly okRules?: readonly OkRule[]
  /** The surface's typed refusal, and every code decided to exit with it; a code in neither list is undecided. */
  readonly refused: { readonly exit: number; readonly codes: readonly string[] }
  /** First match wins, so a rule with a details value goes before the plain rule for its code. */
  readonly rules: readonly ExitRule[]
}

const holds = (details: Failure["details"], wanted: ExitRule["details"]): boolean =>
  wanted === undefined || Object.entries(wanted).every(([field, value]) => details?.[field] === value)

// A passed-through status is an exit only from 1 to 255, so a failure can never exit 0 through it.
const passedStatus = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 255 ? value : undefined

const fieldsHold = (value: unknown, wanted: OkRule["result"]): boolean =>
  typeof value === "object" &&
  value !== null &&
  Object.entries(wanted).every(([field, expected]) => (value as Record<string, unknown>)[field] === expected)

export function exitOf(surface: SurfaceExits, answer: Answer): number {
  if (answer.kind === "ok")
    return surface.okRules?.find((rule) => fieldsHold(answer.value, rule.result))?.exit ?? surface.ok
  const failure = answer.error
  for (const rule of surface.rules) {
    if (rule.code !== failure.code || !holds(failure.details, rule.details)) continue
    if ("exit" in rule) return rule.exit
    const status = passedStatus(failure.details?.[rule.exitFrom])
    if (status !== undefined) return status
  }
  return surface.refused.exit
}

/** The codes a surface decides: its rules' and its refused list's. A registered code outside both is undecided. */
export const decidedCodes = (surface: SurfaceExits): ReadonlySet<string> =>
  new Set([...surface.rules.map((rule) => rule.code), ...surface.refused.codes])
