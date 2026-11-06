import { describe, expect, test } from "bun:test"
import type { DesktopSyncDescriptor } from "@oh-my-opencode/memory-core/sync-engine"
import { openDesktopSyncAccount, type DesktopSyncEngineWire } from "./desktopSyncAccount"
import type { DesktopSyncRequest } from "./desktopSyncProtocol"

// Contract (account-transport-api v11 section 6): the genesis bridge is bound to the operation's own main-issued
// handle, offered only when the descriptor supports genesis, and never runs on the background account handle.

const descriptor = (genesis: "supported" | "unsupported"): DesktopSyncDescriptor => ({
  genesis, rpId: genesis === "supported" ? "recovery.example.test" : null, userName: genesis === "supported" ? "account-1" : null,
  serviceOrigin: "https://api.example.test", accountId: "account-1", serviceDeviceId: "device-1",
  syncPrincipalId: "principal-1", publicKeys: { signing: "signing-1", sealing: "sealing-1" },
  generation: "generation-1", incarnation: "incarnation-1",
})

function fakeMain(genesis: "supported" | "unsupported") {
  const sent: DesktopSyncRequest[] = []
  let handles = 0
  const lifetime = new AbortController()
  const wire: DesktopSyncEngineWire = {
    signal: lifetime.signal,
    close: () => lifetime.abort(),
    onEvent: () => () => {},
    request: async request => {
      sent.push(request)
      switch (request.op) {
        case "descriptor": return descriptor(genesis)
        case "operationBegin": handles += 1; return { handle: `h-${handles}` }
        case "capability": return { prfSupported: true, genesisSupported: true }
        case "genesisRun": return { ok: false, reason: "cancelled" }
        default: return {}
      }
    },
  }
  return { wire, sent }
}
const owner = () => ({ signal: new AbortController().signal, admit: <T>(effect: () => T) => effect() })

describe("the desktop operation genesis bridge", () => {
  test("runs on the operation's own handle under the caller's admission", async () => {
    const main = fakeMain("supported")
    const account = await openDesktopSyncAccount(main.wire, "/unused")
    const operation = await account.forOperation(owner())
    if (operation.genesis === undefined) throw new Error("a genesis-capable account offered no bridge")
    expect(operation.genesis.prfSupported).toBe(true)
    let admitted = 0
    const result = await operation.genesis.createGenesis(
      { account: "account-1", rpId: "recovery.example.test", userName: "account-1", roaming: false, firstDevice: { kind: "device", id: "d", signing_public_key: "s", sealing_public_key: "e" } },
      { operation: { signal: new AbortController().signal, admit: effect => { admitted += 1; return effect() } } },
    )
    expect(result).toEqual({ ok: false, reason: "cancelled" })
    expect(admitted).toBe(1)
    const begins = main.sent.filter(request => request.op === "operationBegin").length
    const run = main.sent.find(request => request.op === "genesisRun")
    expect(begins).toBe(2)
    expect(run !== undefined && "handle" in run ? run.handle : undefined).toBe("h-2")
  })

  test("is absent when main does not support genesis", async () => {
    const main = fakeMain("unsupported")
    const account = await openDesktopSyncAccount(main.wire, "/unused")
    const operation = await account.forOperation(owner())
    expect(operation.genesis).toBeUndefined()
    expect(main.sent.some(request => request.op === "capability")).toBe(false)
  })

  test("is never offered on the background account ports", async () => {
    const account = await openDesktopSyncAccount(fakeMain("supported").wire, "/unused")
    expect("genesis" in account).toBe(false)
  })
})
