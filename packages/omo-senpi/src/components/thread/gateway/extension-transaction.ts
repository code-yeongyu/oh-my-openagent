import { checkExtensionSchema, extensionSchema, extensionSql } from "./extension-sql"
import { orderByClause, orderByTerms, singleExtensionStatement } from "./extension-statement"
import type * as ops from "./store-ops"
import type { LegacyBinding, LegacyBindingWhere, StoreExtensionTransaction } from "./store-extensions"

export class ExtensionTransactionEndedError extends Error {
  readonly code = "extension_operation_failed"
  constructor(readonly extension: string) {
    super(`The ${extension} extension transaction has ended.`)
  }
}

function legacyBindingFor(ctx: ops.StoreContext, where: LegacyBindingWhere): LegacyBinding | null {
  const place = [where?.platform, where?.account_id, where?.chat_id, where?.thread_id]
  if (!place.every((part) => typeof part === "string"))
    throw new TypeError("bindingFor needs string platform, account_id, chat_id and thread_id.")
  if (ctx.sql.one(["name"], "SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'bindings'") === undefined)
    return null
  const row = ctx.sql.one(
    ["binding_id", "policy_id", "session_durable_id"],
    `SELECT binding_id, policy_id, session_durable_id FROM bindings
     WHERE platform = ? AND account_id = ? AND chat_id = ? AND thread_id = ? AND status = 'active'
       AND (expires_at IS NULL OR expires_at > ?)`,
    [...place, new Date().toISOString()],
  )
  if (row === undefined) return null
  return {
    binding_id: String(row.binding_id),
    policy_id: String(row.policy_id),
    session_durable_id: String(row.session_durable_id),
  }
}

export function extensionTransaction(ctx: ops.StoreContext, name: string) {
  let active = true
  let failure: unknown
  function sql<T>(statement: string, body: () => T): T {
    if (!active) throw new ExtensionTransactionEndedError(name)
    if (failure !== undefined) throw failure
    const before = extensionSchema(ctx.sql)
    try {
      singleExtensionStatement(statement)
      const value = extensionSql(ctx.sql, name, body)
      checkExtensionSchema(ctx.sql, name, before, extensionSchema(ctx.sql))
      return value
    } catch (error) {
      failure = error
      throw error
    }
  }
  const tx: StoreExtensionTransaction = {
    all: (columns, statement, params, orderBy) =>
      sql(statement, () => {
        for (const column of columns) singleExtensionStatement(column)
        if (orderBy === undefined) return ctx.sql.all(columns, statement, params)
        const terms = orderByTerms(orderBy)
        // Pass the statement through the extension's authorizer (WHERE 0, so no rows) before its output columns are read
        // without one, so an unknown-column refusal cannot reveal the shape of a table the extension may not read.
        ctx.sql.all(["0"], `SELECT 0 FROM (${statement}\n) WHERE 0`, params)
        return ctx.sql.all(columns, statement, params, orderByClause(terms, ctx.sql.resultColumns(statement)))
      }),
    one: (columns, statement, params) =>
      sql(statement, () => {
        for (const column of columns) singleExtensionStatement(column)
        return ctx.sql.one(columns, statement, params)
      }),
    exec: (statement, params) => sql(statement, () => ctx.sql.run(statement, params)),
    bindingFor: async (where) => {
      if (!active) throw new ExtensionTransactionEndedError(name)
      if (failure !== undefined) throw failure
      return legacyBindingFor(ctx, where)
    },
  }
  return {
    tx,
    cancel: () => {
      active = false
    },
    finish: async () => {
      active = false
      if (failure !== undefined) throw failure
    },
  }
}
