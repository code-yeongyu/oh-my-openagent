export function rows(tx, args) {
  return tx.all(["id", "value"], `SELECT id, value FROM ${args.name}_items`, [], "id")
}

export function put(tx, args) {
  tx.exec(`INSERT INTO ${args.name}_items (id, value) VALUES (?, ?)`, [args.id, args.value])
  return tx.one(["value"], `SELECT value FROM ${args.name}_items WHERE id = ?`, [args.id])
}

export function sql(tx, args) {
  return args.columns ? tx.all(args.columns, args.sql, args.params, args.orderBy) : tx.exec(args.sql, args.params)
}

export async function legacyBinding(tx, args) {
  return await tx.bindingFor(args.where)
}

export function swallow(tx, args) {
  if (args.before) tx.exec(args.before)
  try {
    tx.exec(args.sql)
  } catch {
    return "caught"
  }
}
