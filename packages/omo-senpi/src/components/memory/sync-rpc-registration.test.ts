import { describe, expect, test } from "bun:test"
import { registerSyncRpc } from "./sync-rpc-registration"
import type { SyncRpcContext, SyncRpcOptions, SyncRpcRegistration } from "./sync-rpc-ports"

const verbs = ["enable", "pending", "approve", "status", "devices"] as const
type Handler = Parameters<SyncRpcRegistration["handle"]>[1]

function fixture() {
  let reads = 0
  let allocations = 0
  const handlers = new Map<string, Handler>()
  const options: SyncRpcOptions = {
    source: async () => { reads += 1; return null },
    runtime: {
      enableSync: async () => { throw new Error("unexpected enable") },
      joinAccount: async () => { throw new Error("unexpected join") },
      approveDevice: async () => { throw new Error("unexpected approval") },
    },
    claims: { acquire: async () => { allocations += 1; throw new Error("unexpected allocation") } },
    pinDir: "/unused",
    signal: new AbortController().signal,
    syncStatus: async () => { reads += 1; return undefined },
  }
  const coordinator = registerSyncRpc({ handle: (name, handler) => { handlers.set(name, handler) } }, options)
  const call = (verb: string, context?: SyncRpcContext, data: unknown = {}) => {
    const handler = handlers.get(`omo.memory.sync.${verb}`)
    if (handler === undefined) throw new Error(`unregistered method ${verb}`)
    return handler(data, context)
  }
  return { call, coordinator, reads: () => reads, allocations: () => allocations }
}

describe("registered G3 authority boundary", () => {
  for (const verb of verbs) {
    test(`#given missing context #when ${verb} is called #then no state or account is touched`, async () => {
      const f = fixture()
      expect(await f.call(verb, undefined, { ownerId: "forged", action: "begin", pendingId: "p" })).toMatchObject({ kind: "unavailable" })
      expect(f.reads()).toBe(0)
      expect(f.allocations()).toBe(0)
      await f.coordinator.dispose()
    })

    test(`#given retired atomic gate with delayed abort #when ${verb} is called #then no allocation occurs`, async () => {
      const f = fixture()
      const context: SyncRpcContext = {
        ownerId: "trusted",
        disconnectSignal: new AbortController().signal,
        admit: () => { throw new Error("retired private gate detail") },
      }
      const result = await f.call(verb, context, { action: "begin", pendingId: "p" })
      expect(result).toMatchObject({ kind: "unavailable" })
      expect(JSON.stringify(result)).not.toContain("private gate detail")
      expect(f.reads()).toBe(0)
      expect(f.allocations()).toBe(0)
      await f.coordinator.dispose()
    })
  }

  test("#given a live context but signed-out source #when enable runs #then there is no alternative source", async () => {
    const f = fixture()
    expect(await f.call("enable", { ownerId: "a", disconnectSignal: new AbortController().signal, admit: (dispatch) => dispatch() })).toMatchObject({ kind: "unavailable" })
    expect(f.reads()).toBe(1)
    expect(f.allocations()).toBe(0)
    await f.coordinator.dispose()
  })
})
