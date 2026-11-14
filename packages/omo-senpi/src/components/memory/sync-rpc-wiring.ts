import { join } from "node:path"
import type { DeviceAccountSource } from "./device-session/account-source"
import type { MemoryRpcSync } from "./memory-rpc-sync"
import { createSyncRpcClaims } from "./sync-rpc-claims"
import type { SyncRpcAccount, SyncRpcRegistration } from "./sync-rpc-ports"
import { registerSyncRpc } from "./sync-rpc-registration"

export function wireSyncRpc(options: {
  readonly rpc: SyncRpcRegistration
  readonly source: DeviceAccountSource | (() => Promise<SyncRpcAccount | null>)
  readonly memoryRoot: string
  readonly pinDir: string
  readonly signal: AbortSignal
  readonly syncStatus: () => Promise<MemoryRpcSync | undefined>
  readonly warn?: (message: string, fields: Record<string, unknown>) => void
}) {
  let warnedLegacy = false
  return registerSyncRpc(options.rpc, {
    source: async () => {
      const account = await options.source()
      // Legacy CLI sources cannot prove a captured generation. Only the selected source's
      // operation-capable branch may be used; there is deliberately no credential fallback.
      if (account !== null && "descriptor" in account && "forOperation" in account) return account
      // Say once why sync has no account when a source did answer (#13153).
      if (account !== null && !warnedLegacy) {
        warnedLegacy = true
        options.warn?.("memory sync source has no operation-capable account", { code: "legacy_source" })
      }
      return null
    },
    runtime: {
      enableSync: async (input) => (await import("#omo-memory-sync-runtime")).enableSync(input),
      joinAccount: async (input) => (await import("#omo-memory-sync-runtime")).joinAccount(input),
      approveDevice: async (input) => (await import("#omo-memory-sync-runtime")).approveDevice(input),
    },
    claims: createSyncRpcClaims(join(options.memoryRoot, "runtime", "sync-rpc-claims")),
    pinDir: options.pinDir,
    signal: options.signal,
    syncStatus: options.syncStatus,
    ...(options.warn === undefined ? {} : { warn: options.warn }),
  })
}
