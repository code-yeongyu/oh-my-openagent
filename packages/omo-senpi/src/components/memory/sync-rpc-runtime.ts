import { join } from "node:path"
import type { PhraseGate } from "@oh-my-opencode/memory-core/sync-engine"
import { createSyncRpcClaims } from "./sync-rpc-claims"
import { createSyncRpcDispatcher } from "./sync-rpc-registration"
import type { SyncRpcWiringOptions } from "./sync-rpc-wiring"

export function createSyncRpcRuntime(options: SyncRpcWiringOptions, phraseGate: PhraseGate) {
  let warnedLegacy = false
  return createSyncRpcDispatcher({
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
      disableSync: async (input) => (await import("#omo-memory-sync-runtime")).disableSync(input),
      joinAccount: async (input) => (await import("#omo-memory-sync-runtime")).joinAccount(input),
      approveDevice: async (input) => (await import("#omo-memory-sync-runtime")).approveDevice(input),
      phraseNoticeStatus: async (place) => (await import("#omo-memory-sync-runtime")).phraseNoticeStatus(place),
      acknowledgePhraseVoid: async (input) => (await import("#omo-memory-sync-runtime")).acknowledgePhraseVoid(input),
    },
    claims: createSyncRpcClaims(join(options.memoryRoot, "runtime", "sync-rpc-claims")),
    pinDir: options.pinDir,
    signal: options.signal,
    syncStatus: options.syncStatus,
    ...(options.stopSync === undefined ? {} : { stopSync: options.stopSync }),
    ...(options.resumeSync === undefined ? {} : { resumeSync: options.resumeSync }),
    phraseGate,
    ...(options.warn === undefined ? {} : { warn: options.warn }),
  })
}
