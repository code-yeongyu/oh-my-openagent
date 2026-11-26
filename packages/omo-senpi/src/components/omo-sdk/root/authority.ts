import type { OmoFailure, OmoPrincipal, RootCallKey } from "../contract"
import { ROOT_CALL_ANSWERS } from "../contract/call-answers"
import { OMO_CODE_REGISTRY, type OmoCode } from "../contract/codes"
import { PRINCIPAL_MATRIX } from "../contract/principal-matrix"
import { HELD_ALLOWS } from "./held-allows"
import { PENDING_CELLS } from "./pending-cells"

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

/** The calls no line of the matrix names: a pair with no cell is refused by default, never served by omission. */
export const UNLINED_CALLS: readonly RootCallKey[] = (Object.keys(ROOT_CALL_ANSWERS) as RootCallKey[]).filter(
  (call) => !PRINCIPAL_MATRIX.some((line) => (line.rows as readonly string[]).includes(call)),
)

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
  const held = HELD_ALLOWS.filter((entry) => entry.principal === principal.kind).map((entry) => entry.call)
  for (const call of [...UNLINED_CALLS, ...held]) {
    if (PENDING_CELLS.some((pending) => pending.call === call && pending.principal === principal.kind)) continue
    refusals.set(call, {
      code: "sender_not_allowed",
      message: `${call} has no cell for a ${principal.kind} principal in security design 4, so it is refused.`,
      next_action: OMO_CODE_REGISTRY.sender_not_allowed.next_action,
      details: { principal: principal.kind, reason: "no_matrix_cell" },
    })
  }
  return refusals
}
