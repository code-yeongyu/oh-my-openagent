import { ExtensionSchemaViolation, sqliteName } from "./extension-sql"
import { sqlTokens } from "./sql-tokens"

/** Keep statement-scoped catalog authorization from carrying into another statement. */
export function singleExtensionStatement(sql: string): void {
  let ended = false
  for (const token of sqlTokens(sql)) {
    if (token.kind === "space" || token.kind === "comment") continue
    if (ended) throw new ExtensionSchemaViolation("An extension SQL call must contain one statement.")
    if (token.kind === "semicolon") ended = true
  }
}

const ORDER_TERM = /^[ \t\r\n]*([A-Za-z_][A-Za-z0-9_]*)(?:[ \t\r\n]+COLLATE[ \t\r\n]+(BINARY|NOCASE|RTRIM))?(?:[ \t\r\n]+(ASC|DESC))?(?:[ \t\r\n]+NULLS[ \t\r\n]+(FIRST|LAST))?[ \t\r\n]*$/i
const ECHO_MAX = 80

export type OrderTerm = {
  readonly column: string
  readonly collate: "BINARY" | "NOCASE" | "RTRIM" | undefined
  readonly direction: "ASC" | "DESC" | undefined
  readonly nulls: "FIRST" | "LAST" | undefined
}

const echo = (text: string): string => JSON.stringify(text.length > ECHO_MAX ? `${text.slice(0, ECHO_MAX)}…` : text)
const upper = <T extends string>(word: string | undefined): T | undefined => word?.toUpperCase() as T | undefined

/**
 * `all()` splices `orderBy` into `row_number() OVER (ORDER BY ...)` and into the outer ORDER BY over the statement,
 * so only the statement's output columns can stand there. Each comma-separated term must be one column name with
 * an optional `COLLATE BINARY|NOCASE|RTRIM`, `ASC`/`DESC` and `NULLS FIRST`/`NULLS LAST`; anything else is refused.
 */
export function orderByTerms(orderBy: string): readonly OrderTerm[] {
  return orderBy.split(",").map((term) => {
    const match = ORDER_TERM.exec(term)
    if (match === null) {
      throw new ExtensionSchemaViolation(`orderBy must list the statement's output columns, each optionally with COLLATE BINARY/NOCASE/RTRIM, ASC/DESC or NULLS FIRST/LAST; got ${echo(orderBy)}. Put LIMIT, OFFSET and table-qualified ordering in the statement itself.`)
    }
    return { column: match[1] as string, collate: upper(match[2]), direction: upper(match[3]), nulls: upper(match[4]) }
  })
}

/**
 * The ORDER BY text `all()` splices, built only from validated parts: each column is matched against the statement's
 * own output columns (ASCII case-insensitively, as SQLite resolves names) and written as that column's quoted name,
 * followed by fixed keywords. The caller's text never reaches the SQL.
 */
export function orderByClause(terms: readonly OrderTerm[], resultColumns: readonly string[]): string {
  return terms.map((term) => {
    const column = resultColumns.find((name) => sqliteName(name) === sqliteName(term.column))
    if (column === undefined) {
      throw new ExtensionSchemaViolation(`orderBy must list the statement's output columns; ${echo(term.column)} is not one of them (${echo(resultColumns.join(", "))}). Select it in the statement or order by a column it returns.`)
    }
    return [`"${column.replaceAll('"', '""')}"`, term.collate && `COLLATE ${term.collate}`, term.direction, term.nulls && `NULLS ${term.nulls}`].filter(Boolean).join(" ")
  }).join(", ")
}
