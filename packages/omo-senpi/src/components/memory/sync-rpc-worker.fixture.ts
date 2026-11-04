import { parentPort, workerData } from "node:worker_threads"
import { z } from "zod"
import { createDeviceKeyring } from "../../../../memory-core/src/sync/keyring-port"
import { createAccountHttp } from "../../../../memory-core/src/sync/account/http"
import { createPairingHttp } from "../../../../memory-core/src/sync/account/pairing-http"
import { enableSync } from "../../../../memory-core/src/sync/account/enable"
import { joinAccount } from "../../../../memory-core/src/sync/account/join"
import { approveDevice } from "../../../../memory-core/src/sync/account/approve"
import { createSyncRpcClaims } from "./sync-rpc-claims"
import { registerSyncRpc } from "./sync-rpc-registration"
import type { SyncRpcAccount, SyncRpcRegistration } from "./sync-rpc-ports"

const data = z.object({
  root: z.string(), api: z.string(), token: z.string(), principalId: z.string(),
  material: z.object({ signingPrivatePkcs8: z.string(), sealingPrivatePkcs8: z.string() }),
}).parse(workerData)
const keyring = createDeviceKeyring(data.principalId, data.material)
const controller = new AbortController()
const account: SyncRpcAccount = {
  descriptor: {
    genesis: "unsupported", rpId: null, userName: null,
    serviceOrigin: data.api, accountId: "worker-pairing", serviceDeviceId: "shared-device",
    syncPrincipalId: data.principalId, publicKeys: keyring.publicKeys(), generation: "g1", incarnation: "main-1",
  },
  signal: controller.signal, isCurrent: async () => !controller.signal.aborted,
  boundary: async (dispatch) => { controller.signal.throwIfAborted(); return dispatch() },
  forOperation: async () => {
    const options = { baseUrl: data.api, token: () => data.token }
    return { keyring, chain: createAccountHttp(options), pairing: createPairingHttp(options), devices: async () => [], close: async () => undefined }
  },
}
const handlers = new Map<string, Parameters<SyncRpcRegistration["handle"]>[1]>()
const coordinator = registerSyncRpc({ handle: (name, handler) => { handlers.set(name, handler) } }, {
  source: async () => account, claims: createSyncRpcClaims(data.root),
  pinDir: `${data.root}/pins`, signal: controller.signal, syncStatus: async () => undefined,
  clock: { now: Date.now, sleep: () => new Promise<void>(() => {}) },
  runtime: {
    enableSync, approveDevice,
    joinAccount: (input) => joinAccount({
      ...input,
      pairing: {
        ...input.pairing,
        openPending: async (account, commitment) => {
          const row = await input.pairing.openPending(account, commitment)
          input.onPending(row)
          return row
        },
      },
    }),
  },
})
parentPort?.on("message", async (message: unknown) => {
  if (message === "stop") {
    controller.abort()
    await coordinator.dispose()
    parentPort?.postMessage({ kind: "stopped" })
    return
  }
  if (message !== "start") return
  const handler = handlers.get("omo.memory.sync.enable")
  if (handler === undefined) throw new Error("missing handler")
  const result = await handler({}, {
    ownerId: crypto.randomUUID(), disconnectSignal: controller.signal,
    admit: (effect) => { controller.signal.throwIfAborted(); return effect() },
  })
  parentPort?.postMessage({ kind: "result", result })
})
parentPort?.postMessage({ kind: "ready" })
