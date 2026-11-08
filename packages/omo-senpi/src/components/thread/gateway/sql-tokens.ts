type SqlToken = {
  readonly kind: "space" | "comment" | "quoted" | "parameter" | "semicolon" | "text"
  readonly text: string
}

/** SQLite quotes double their closing quote; bracket identifiers and comments do not nest. */
export function* sqlTokens(sql: string): Generator<SqlToken> {
  for (let i = 0; i < sql.length;) {
    const start = i
    const c = sql[i]
    let kind: SqlToken["kind"]
    if (c <= " ") {
      kind = "space"
      while (i < sql.length && sql[i] <= " ") i++
    } else if (c === "-" && sql[i + 1] === "-") {
      kind = "comment"
      while (i < sql.length && sql[i] !== "\n") i++
    } else if (c === "/" && sql[i + 1] === "*") {
      kind = "comment"
      i += 2
      while (i < sql.length && !(sql[i] === "*" && sql[i + 1] === "/")) i++
      i = Math.min(i + 2, sql.length)
    } else if (c === "'" || c === '"' || c === "`" || c === "[") {
      kind = "quoted"
      const end = c === "[" ? "]" : c
      i++
      while (i < sql.length) {
        if (sql[i++] !== end) continue
        if (c !== "[" && sql[i] === end) { i++; continue }
        break
      }
    } else if (c === "?" || c === ";") {
      kind = c === "?" ? "parameter" : "semicolon"
      i++
    } else {
      kind = "text"
      i++
      while (i < sql.length && sql[i] > " " && !["'", '"', "`", "[", "?", ";", "-", "/"].includes(sql[i])) i++
    }
    yield { kind, text: sql.slice(start, i) }
  }
}
