import { createGatewayEngine, type GatewayEngineOptions, type GatewayResolve } from "./engine"
import { checkExtensionSchema, extensionSchema, extensionSql } from "./extension-sql"
import { orderByColumns, singleExtensionStatement } from "./extension-statement"
import { createGatewayRelay, type GatewayRelayOptions } from "./relay"
import * as ops from "./store-ops"
import * as relay from "./store-relay-ops"
import type { StoreExtensionTransaction } from "./store-extensions"

export class ExtensionTransactionEndedError extends Error {
  readonly code = "extension_operation_failed"
  constructor(readonly extension: string) {
    super(`The ${extension} extension transaction has ended.`)
  }
}

export function extensionTransaction(ctx: ops.StoreContext, name: string, now: number, resolveTarget: GatewayResolve) {
  let active = true
  let cancelled = false
  let failure: unknown
  let tail = Promise.resolve()
  const checkActive = (): void => {
    if (!active) throw new ExtensionTransactionEndedError(name)
    if (failure !== undefined) throw failure
  }
  function joined<T>(body: () => T): T {
    if (cancelled) throw new ExtensionTransactionEndedError(name)
    if (failure !== undefined) throw failure
    return body()
  }
  function schedule<T>(body: () => Promise<T>): Promise<T> {
    const next = active ? tail.then(() => joined(body)) : Promise.reject<T>(new ExtensionTransactionEndedError(name))
    tail = next.then(() => undefined, (error: unknown) => { failure = error })
    return next
  }
  function sql<T>(statement: string, body: () => T): T {
    checkActive()
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
  const store: GatewayRelayOptions["store"] & GatewayEngineOptions["store"] = {
    now: () => now,
    busyTimeoutMs: ctx.config.busy_timeout_ms,
    enqueue: (request) => joined(() => ops.enqueue(ctx, request)),
    completeReceipt: (request) => joined(() => ops.completeReceipt(ctx, request)),
    abandonReceipt: (request) => joined(() => ops.abandonReceipt(ctx, request)),
    deliveryView: async (id) => joined(() => ops.deliveryView(ctx, id)),
    deliveryReceipt: async (request) => joined(() => ops.deliveryReceipt(ctx, request)),
    recoverDelivery: (request) => joined(() => ops.recoverDelivery(ctx, request)),
    bind: (request) => joined(() => relay.bindThread(ctx, request)),
    unbind: (request) => joined(() => relay.unbindThread(ctx, request)),
    rebind: (request) => joined(() => relay.rebindThread(ctx, request)),
    listBindings: (request) => joined(() => relay.listBindings(ctx, request)),
    bindingView: (request) => joined(() => relay.bindingView(ctx, request)),
    report: (request) => joined(() => relay.reportEvent(ctx, request)),
    readOutbox: (request) => joined(() => relay.readOutbox(ctx, { ...request, pendingOnly: true })),
    ackOutbox: (request) => joined(() => relay.ackOutbox(ctx, request)),
    claimAnswer: (request) => joined(() => relay.claimAnswer(ctx, request)),
    releaseAnswer: (request) => joined(() => relay.releaseAnswer(ctx, request)),
    confirmAnswer: (request) => joined(() => relay.confirmAnswer(ctx, request)),
    markPriorDelivered: (request) => joined(() => relay.markPriorDelivered(ctx, request)),
    emitCompletions: (request) => joined(() => relay.emitCompletions(ctx, request)),
  }
  // Resolve through the relay's address book, but never wake a receiver before COMMIT.
  const endpoints = { wake: async (): Promise<never> => { throw new Error("An extension enqueue cannot contact a live endpoint.") } }
  const engine = createGatewayEngine({
    store,
    endpoints,
    resolve: async (address, request) => {
      const result = await resolveTarget(address, request)
      return result.kind === "error" ? result : { kind: "ok", target: { ...result.target, endpoint: null, liveness: "dead" } }
    },
  })
  const api = createGatewayRelay({ store, engine, endpoints, locate: async () => null })
  const tx: StoreExtensionTransaction = {
    all: (columns, statement, params, orderBy) => sql(statement, () => {
      for (const column of columns) singleExtensionStatement(column)
      if (orderBy !== undefined) orderByColumns(orderBy)
      return ctx.sql.all(columns, statement, params, orderBy)
    }),
    one: (columns, statement, params) => sql(statement, () => {
      for (const column of columns) singleExtensionStatement(column)
      return ctx.sql.one(columns, statement, params)
    }),
    exec: (statement, params) => sql(statement, () => ctx.sql.run(statement, params)),
    enqueue: (request) => schedule(() => api.inbound(request)),
    outboxAck: (request) => schedule(() => api.ack(request)),
    bind: (request) => schedule(() => api.bind(request)),
    unbind: (request) => schedule(() => api.unbind(request)),
    rebind: (request) => schedule(() => api.rebind(request)),
    bindingFor: (request) => schedule(() => relay.bindingFor(ctx, { ...request, now })),
    outboxPending: (request) => schedule(() => api.outbox(request)),
  }
  return {
    tx,
    cancel: () => {
      active = false
      cancelled = true
      api.dispose()
    },
    finish: async () => {
      active = false
      await tail
      api.dispose()
      if (failure !== undefined) throw failure
    },
  }
}
