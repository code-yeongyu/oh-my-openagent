import { parentPort, workerData } from "node:worker_threads"
import { z } from "zod"
import { createSyncRpcClaims } from "./sync-rpc-claims"
import type { SyncRpcClaim } from "./sync-rpc-ports"

const data = z.object({
  root: z.string(),
  identity: z.object({
    genesis: z.enum(["supported", "unsupported"]), rpId: z.string().nullable(), userName: z.string().nullable(),
    serviceOrigin: z.string(), accountId: z.string(), serviceDeviceId: z.string(), syncPrincipalId: z.string(),
    publicKeys: z.object({ signing: z.string(), sealing: z.string() }), generation: z.string(), incarnation: z.string(),
  }),
}).parse(workerData)
const claims = createSyncRpcClaims(data.root)
let held: SyncRpcClaim | null = null
parentPort?.on("message", async (message: unknown) => {
  if (message !== "start") return
  held = await claims.acquire(data.identity, "enable", undefined, {
    signal: new AbortController().signal, admit: (effect) => effect(), boundary: async (effect) => effect(),
  })
  parentPort?.postMessage({ kind: "claimed", acquired: held !== null })
})
