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
