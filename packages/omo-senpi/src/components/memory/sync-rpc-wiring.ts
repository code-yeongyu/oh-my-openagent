import type { DeviceAccountSource } from "./device-session/account-source"
import type { MemoryRpcSync } from "./memory-rpc-sync"
import { phraseGateFrom } from "./sync-phrase-gate"
import { SYNC_RPC_VERBS, syncRpcHandlerFailure, syncRpcUntrusted, type SyncRpcVerb } from "./sync-rpc-contract"
import type { SyncRpcAccount, SyncRpcContext, SyncRpcRegistration } from "./sync-rpc-ports"
import type { createSyncRpcRuntime } from "./sync-rpc-runtime"

export interface SyncRpcWiringOptions {
  readonly rpc: SyncRpcRegistration
  readonly source: DeviceAccountSource | (() => Promise<SyncRpcAccount | null>)
  readonly memoryRoot: string
  readonly pinDir: string
  readonly signal: AbortSignal
  readonly syncStatus: () => Promise<MemoryRpcSync | undefined>
  readonly stopSync?: () => Promise<void>
  readonly resumeSync?: () => Promise<void>
  readonly logger: { error(message: string, fields?: Record<string, unknown>): void }
  readonly warn?: (message: string, fields: Record<string, unknown>) => void
}

export function wireSyncRpc(options: SyncRpcWiringOptions) {
  // The gate is built once at registration, even when the dispatcher is cold.
  const phraseGate = phraseGateFrom(options.logger)
  type Runtime = ReturnType<typeof createSyncRpcRuntime>
  let runtime: Runtime | undefined
  let pending: Promise<Runtime> | undefined
  let binding = 0
  const loadRuntime = async () => {
    const { createSyncRpcRuntime } = await import("#omo-memory-sync-rpc-runtime")
    return createSyncRpcRuntime(options, phraseGate)
  }
  const dispatchCold = async (verb: SyncRpcVerb, data: unknown, context?: SyncRpcContext) => {
    const acceptedBinding = binding
    let loaded: Runtime
    try {
      loaded = await (pending ??= loadRuntime().catch((error: unknown) => {
        pending = undefined
        throw error
      }))
    } catch (error) {
      options.warn?.("memory sync RPC sidecar failed to load", {
        path: verb,
        code: "handler_failed",
        error: error instanceof Error ? error.name : typeof error,
      })
      return syncRpcHandlerFailure()
    }
    runtime = loaded
    // A request waiting on the import must not reach the next session binding.
    return acceptedBinding === binding ? loaded.dispatch(verb, data, context) : syncRpcUntrusted()
  }
  for (const verb of SYNC_RPC_VERBS) {
    options.rpc.handle(`omo.memory.sync.${verb}`, (data, context) =>
      runtime === undefined ? dispatchCold(verb, data, context) : runtime.dispatch(verb, data, context),
    )
  }
  return {
    retireBinding() {
      binding++
      runtime?.coordinator.retireBinding()
    },
  }
}
