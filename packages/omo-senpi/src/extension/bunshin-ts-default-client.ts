import { connect, FanoutRun, type BunshinClient, type FleetEvent, type FleetEventSource } from "@bunshin/bunshin-ts"

import { pickTransport } from "./bunshin-ts-pick-transport"

const lazyEvents = (pending: Promise<FleetEventSource>): FleetEventSource => {
  let iterator: AsyncIterator<FleetEvent> | undefined
  return {
    subscribe(listener) {
      let unsubscribe: (() => void) | undefined
      let cancelled = false
      void pending.then((events) => {
        if (!cancelled) unsubscribe = events.subscribe(listener)
      })
      return () => {
        cancelled = true
        unsubscribe?.()
      }
    },
    [Symbol.asyncIterator]() {
      return {
        async next() {
          iterator ??= (await pending)[Symbol.asyncIterator]()
          return iterator.next()
        },
        async return() {
          if (iterator?.return === undefined) return { done: true as const, value: undefined }
          return iterator.return()
        },
      }
    },
  }
}

/**
 * A client that connects on its first awaited call and reuses that connection. Property access never connects;
 * a failed connect is not memoized, so the next call retries; `close()` drops the connection.
 */
export function createLazyBunshinClient(open: () => Promise<BunshinClient>): BunshinClient {
  let memo: Promise<BunshinClient> | undefined
  const client = (): Promise<BunshinClient> => {
    if (memo !== undefined) return memo
    const pending = open()
    memo = pending
    pending.catch(() => {
      if (memo === pending) memo = undefined
    })
    return pending
  }
  return {
    setPolicy: (machineId, policy) => client().then((c) => c.setPolicy(machineId, policy)),
    getPolicy: (machineId) => client().then((c) => c.getPolicy(machineId)),
    listMachines: () => client().then((c) => c.listMachines()),
    fanout: (targets, fn, options) => FanoutRun.defer(client(), (c) => c.fanout(targets, fn, options)),
    getMachine: (idOrAlias) => client().then((c) => c.getMachine(idOrAlias)),
    findMachine: (query) => client().then((c) => c.findMachine(query)),
    listTools: (idOrAlias) => client().then((c) => c.listTools(idOrAlias)),
    resultOf: (requestId) => client().then((c) => c.resultOf(requestId)),
    events: (options) => lazyEvents(client().then((c) => c.events(options))),
    close: async () => {
      const pending = memo
      memo = undefined
      if (pending !== undefined) await (await pending).close()
    },
  }
}

export const bunshin: BunshinClient = createLazyBunshinClient(async () => connect({ transport: await pickTransport(process.env) }))
