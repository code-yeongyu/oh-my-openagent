import { ExtensionSchemaViolation } from "./extension-sql"
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

const ORDER_TERM = /^\s*[A-Za-z_][A-Za-z0-9_]*(?:\s+COLLATE\s+[A-Za-z_][A-Za-z0-9_]*)?(?:\s+(?:ASC|DESC))?(?:\s+NULLS\s+(?:FIRST|LAST))?\s*$/i

/**
 * `all()` splices `orderBy` into `row_number() OVER (ORDER BY ...)` and into the outer ORDER BY over the statement,
 * so only the statement's output columns can stand there. Anything else (a LIMIT, an OFFSET, `t.column`) would
 * reach SQLite as broken SQL, so it is refused here with the reason instead.
 */
export function orderByColumns(orderBy: string): void {
  if (orderBy.split(",").every((term) => ORDER_TERM.test(term))) return
  throw new ExtensionSchemaViolation(`orderBy must list the statement's output columns, each optionally with COLLATE, ASC/DESC or NULLS FIRST/LAST; got "${orderBy}". Put LIMIT, OFFSET and table-qualified ordering in the statement itself.`)
}
