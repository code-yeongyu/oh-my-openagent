import { existsSync, readdirSync } from "node:fs"

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

export function swallow(tx, args) {
  if (args.before) tx.exec(args.before)
  try { tx.exec(args.sql) } catch { return "caught" }
}

export async function core(tx, args) {
  return await tx[args.op](args.request)
}

export async function enqueueThenThrow(tx, args) {
  const result = await tx.enqueue(args.request)
  if (result.kind !== "ok") throw new Error(JSON.stringify(result))
  tx.exec("INSERT INTO alpha_items (id, value) VALUES (1, 'rollback')")
  // The wake marker is created inside the transaction now (a committed delivery always has its
  // marker); the rollback compensation removes it when this operation does not commit.
  throw new Error("rollback requested")
}

export async function rebindThenThrow(tx, args) {
  const result = await tx.rebind(args.request)
  if (result.kind !== "ok") throw new Error(JSON.stringify(result))
  if (!existsSync(args.marker)) throw new Error("marker removed before commit")
  throw new Error("rollback requested")
}

export async function bindThenEnqueue(tx, args) {
  const bound = await tx.bind(args.bind)
  if (bound.kind !== "ok") throw new Error(JSON.stringify(bound))
  const found = await tx.bindingFor(args.address)
  const sent = await tx.enqueue({ ...args.send, binding_id: bound.binding.binding_id })
  return { bound, found, sent }
}

export async function ackThenThrow(tx, args) {
  await tx.outboxAck(args)
  throw new Error("rollback requested")
}
