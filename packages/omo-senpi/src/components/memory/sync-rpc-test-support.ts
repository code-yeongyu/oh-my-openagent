import { registerSyncRpc } from "./sync-rpc-registration"
import type { SyncRpcAccount, SyncRpcContext, SyncRpcOptions, SyncRpcRegistration, SyncRpcRuntime } from "./sync-rpc-ports"
import { newDevice, removeWorldStateDirs } from "../../../../memory-core/src/sync/recovery/testing/world.test-support"
import { createAccountHttp } from "../../../../memory-core/src/sync/account/http"
import { createPairingHttp } from "../../../../memory-core/src/sync/account/pairing-http"

type Handler = Parameters<SyncRpcRegistration["handle"]>[1]
const cleanups: (() => Promise<void>)[] = []
export async function disposeSyncRpcFixtures(): Promise<void> {
  for (const cleanup of cleanups.splice(0)) await cleanup()
  removeWorldStateDirs()
}
const deferred = <T>() => Promise.withResolvers<T>()

export function owner(id: string) {
  const abort = new AbortController()
  let retired = false
  const context: SyncRpcContext = {
    ownerId: id,
    disconnectSignal: abort.signal,
    admit: (dispatch) => { if (retired) throw new Error("retired"); return dispatch() },
  }
  return { context, retireGate: () => { retired = true }, retire: () => { retired = true; abort.abort() } }
}

export async function setup() {
  const device = await newDevice()
  const accountAbort = new AbortController()
  const hostAbort = new AbortController()
  const sourceBarrier = deferred<void>()
  let holdSource = false
  let begins = 0
  let closes = 0
  let joins = 0
  let approvals = 0
  const joinDone = deferred<{ readonly kind: "joined" }>()
  const approvalCode = deferred<void>()
  const approvalDisplayed = deferred<void>()
  const joinCode = deferred<void>()
  let claimHeld = false
  const runtime: SyncRpcRuntime = {
    enableSync: async () => ({ kind: "join_required" }),
    joinAccount: async (input) => {
      joins += 1
      input.onPending({ id: "p", expires_at: Date.now() + 60_000 })
      await joinCode.promise
      input.showCode("012345")
      return joinDone.promise
    },
    approveDevice: async (input) => {
      approvals += 1
      input.onAnswered({ id: input.pendingId, expires_at: Date.now() + 60_000 })
      await approvalCode.promise
      const confirmation = input.confirmCode("012345")
      approvalDisplayed.resolve()
      return await confirmation ? { kind: "approved", seq: 2 } : { kind: "declined" }
    },
  }
  const http = { baseUrl: "https://unused.invalid", token: () => { throw new Error("unexpected HTTP request") } }
  const account: SyncRpcAccount = {
    descriptor: { genesis: "unsupported", rpId: null, userName: null, serviceOrigin: http.baseUrl, accountId: "account", serviceDeviceId: "service-device", syncPrincipalId: device.keyring.principal().id, publicKeys: device.keyring.publicKeys(), generation: "generation-1", incarnation: "main-1" },
    signal: accountAbort.signal,
    isCurrent: async () => !accountAbort.signal.aborted,
    boundary: async (dispatch) => { accountAbort.signal.throwIfAborted(); return dispatch() },
    forOperation: async (authority) => {
      authority.admit(() => { begins += 1 })
      return {
        keyring: device.keyring,
        chain: createAccountHttp(http),
        pairing: createPairingHttp(http),
        devices: async () => [],
        close: async () => { closes += 1 },
      }
    },
  }
  const handlers = new Map<string, Handler>()
  const options: SyncRpcOptions = {
    source: async () => { if (holdSource) await sourceBarrier.promise; return account },
    runtime,
    claims: { acquire: async () => {
      if (claimHeld) return null
      claimHeld = true
      return { expiresAt: async () => undefined, release: async () => { claimHeld = false } }
    } },
    pinDir: "/unused",
    signal: hostAbort.signal,
    syncStatus: async () => ({ state: "paused" }),
  }
  const coordinator = registerSyncRpc({ handle: (name, handler) => { handlers.set(name, handler) } }, options)
  const call = async (verb: string, context: SyncRpcContext, data: unknown = {}): Promise<unknown> => {
    const handler = handlers.get(`omo.memory.sync.${verb}`)
    if (handler === undefined) throw new Error("missing method")
    return handler(data, context)
  }
  cleanups.push(async () => {
    sourceBarrier.resolve()
    joinCode.resolve()
    approvalCode.resolve()
    joinDone.resolve({ kind: "joined" })
    await coordinator.dispose()
  })
  return {
    call, runtime, account, accountAbort, hostAbort, coordinator,
    hold: () => { holdSource = true }, release: () => sourceBarrier.resolve(),
    showJoinCode: () => joinCode.resolve(),
    showApprovalCode: async () => { approvalCode.resolve(); await approvalDisplayed.promise },
    finishJoin: () => joinDone.resolve({ kind: "joined" }),
    counts: () => ({ begins, closes, joins, approvals }),
  }
}
