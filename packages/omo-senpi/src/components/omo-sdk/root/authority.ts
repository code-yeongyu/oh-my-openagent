import {
  OMO_CODE_REGISTRY,
  type OmoCode,
  type OmoFailure,
  type OmoPrincipal,
  PRINCIPAL_MATRIX,
  type RootCallKey,
} from "../contract"

/** The facts of a root a matrix line may be conditioned on: the root options it was built with. */
export type RootFacts = Readonly<Record<string, unknown>>

const registered = (code: string): code is Exclude<OmoCode, "not_implemented"> => Object.hasOwn(OMO_CODE_REGISTRY, code)

// A line applies at the boundary when it names no call input, and its root condition, if any, is an option this root
// was built with. The input-dependent lines (self, author, the send legs, a wider permission preset) are answered by
// the core that reads the input, before its own side effect.
function boundaryLines(facts: RootFacts) {
  return PRINCIPAL_MATRIX.filter(
    (line) => line.input === undefined && Object.keys(line.root ?? {}).every((option) => facts[option] !== undefined),
  )
}

/**
 * Every call the root refuses its principal outright (security design 4), keyed by call, decided once when the root is
 * built: the principal and the options are fixed for the root's life and no call takes either.
 */
export function boundaryRefusals(
  principal: OmoPrincipal,
  facts: RootFacts,
): ReadonlyMap<RootCallKey, OmoFailure["error"]> {
  const refusals = new Map<RootCallKey, OmoFailure["error"]>()
  for (const line of boundaryLines(facts)) {
    const cell = line.cells[principal.kind]
    if (cell.outcome !== "refuse") continue
    const code = registered(cell.code) ? cell.code : "internal_error"
    for (const row of line.rows as RootCallKey[])
      if (!refusals.has(row))
        refusals.set(row, {
          code,
          message: `${row} is not open to a ${principal.kind} principal (security design ${line.section}).`,
          next_action: OMO_CODE_REGISTRY[code].next_action,
          details: { principal: principal.kind },
        })
  }
  return refusals
}
