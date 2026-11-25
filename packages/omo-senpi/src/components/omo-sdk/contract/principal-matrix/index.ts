import type { ChangeId } from "../behaviour-changes"
import { PRINCIPAL_KINDS, type PrincipalKind } from "../principal"
import { ACCOUNT_LINES } from "./account"
import { HOST_LINES } from "./host"
import { LAUNCH_LINES } from "./launch"
import { THREAD_LINES } from "./threads"
import type { MatrixLine } from "./types"

export type { Cell, MatrixLine } from "./types"

// The principal-by-capability matrix of the security design's section 4 (#14945), one line per row of its tables.
export const PRINCIPAL_MATRIX: readonly MatrixLine[] = [
  ...THREAD_LINES,
  ...ACCOUNT_LINES,
  ...HOST_LINES,
  ...LAUNCH_LINES,
]

/** One refused cell on one registry row: answered with `code`, before any side effect, for `principal` only. */
export type Refusal = {
  readonly scenario: string
  readonly row: string
  readonly principal: PrincipalKind
  readonly code: string
  readonly section: MatrixLine["section"]
  readonly change?: ChangeId
  readonly before_side_effect: true
}

const refusalScenarioId = (row: string, slug: string, kind: PrincipalKind): string => `${row}/${slug}-refuses-${kind}`

export const REFUSALS: readonly Refusal[] = PRINCIPAL_MATRIX.flatMap((line) =>
  line.rows.flatMap((row) =>
    PRINCIPAL_KINDS.flatMap((principal): Refusal[] => {
      const cell = line.cells[principal]
      if (cell.outcome !== "refuse") return []
      return [
        {
          scenario: refusalScenarioId(row, line.slug, principal),
          row,
          principal,
          code: cell.code,
          section: line.section,
          ...(cell.change === undefined ? {} : { change: cell.change }),
          before_side_effect: true,
        },
      ]
    }),
  ),
)
