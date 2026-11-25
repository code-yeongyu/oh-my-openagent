import type { ChangeId } from "../behaviour-changes"
import type { PrincipalKind } from "../principal"

// One line of the security design's section 4 (#14945), keyed by the five principal kinds. Person and script share the
// document's one column; a line tells them apart only with `split`, a verbatim quote from sections 3 or 4 that says why,
// and the test fails on a split without the quote or a quote the document does not contain.
export type Cell =
  | { readonly outcome: "allow"; readonly note?: string }
  | { readonly outcome: "refuse"; readonly code: string; readonly change?: ChangeId; readonly note?: string }
  | { readonly outcome: "n/a" }

export type MatrixLine = {
  readonly section: "4.1" | "4.2" | "4.3" | "4.4"
  /** The capability: the document's first column verbatim, or for a line derived from a row with an input or a split
   * the document names, what it covers, with `docRow` naming that row verbatim. */
  readonly capability: string
  readonly docRow?: string
  readonly slug: string
  /** The registry rows the line governs; empty only with `noRow` saying why no root call exists for it. */
  readonly rows: readonly string[]
  readonly noRow?: string
  /** The input that reaches the cell, merged into each row's minimal input by the scenario table. */
  readonly input?: Readonly<Record<string, unknown>>
  /** A root option the cell is about, set when the root is built. */
  readonly root?: Readonly<Record<string, unknown>>
  readonly cells: Readonly<Record<PrincipalKind, Cell>>
  readonly split?: string
}

export const allow = (note?: string): Cell => (note === undefined ? { outcome: "allow" } : { outcome: "allow", note })
export const refuse = (code = "sender_not_allowed", extra: { change?: ChangeId; note?: string } = {}): Cell => ({
  outcome: "refuse",
  code,
  ...extra,
})
export const NA: Cell = { outcome: "n/a" }

type Columns = { readonly people: Cell; readonly session: Cell; readonly connector: Cell; readonly service: Cell }

/** The document's four columns, person and script sharing the first. */
export const columns = ({ people, session, connector, service }: Columns): MatrixLine["cells"] => ({
  person: people,
  script: people,
  session,
  connector,
  service,
})
