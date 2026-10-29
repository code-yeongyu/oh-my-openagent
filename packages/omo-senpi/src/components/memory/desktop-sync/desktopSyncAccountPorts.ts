import { z } from "zod"
import type { AccountHttp, PairingHttp } from "@oh-my-opencode/memory-core/sync-engine"
import type { SyncDevice } from "@oh-my-opencode/memory-core/sync-engine"
import {
  decodeRecoveryWraps,
  decodeSyncEntries,
  decodeSyncKeys,
  decodeSyncPending,
  DesktopSyncServiceError,
  SyncDevices,
  SyncInteger,
  SyncPending,
  syncJson,
  type SyncDescriptor,
} from "./desktopSyncPortSchema"

export type SyncServiceCall = (request: Readonly<Record<string, unknown>>) => Promise<unknown>
const pendingList = z.object({ pending: z.array(SyncPending) })
const appendReply = z.object({ seq: SyncInteger })
const stateReply = z.object({
  head: z.object({ seq: SyncInteger, link: z.string(), keyring_link: z.string() }),
  current_epoch: SyncInteger,
  rotation_pending: z.boolean(),
})

type AppendRequest = Parameters<AccountHttp["appendKeys"]>[0]

/** Native chain/pairing values, not a fake HTTP adapter or a fabricated bearer. */
export function desktopSyncAccountPorts(call: SyncServiceCall, descriptor: SyncDescriptor): {
  readonly chain: AccountHttp
  readonly pairing: PairingHttp
  readonly devices: () => Promise<readonly SyncDevice[]>
} {
  const json = async (request: Readonly<Record<string, unknown>>) => syncJson(await call(request))
  const append = async (op: "appendKeys" | "recoveryJoin", request: AppendRequest) => {
    try {
      return { ok: true as const, seq: appendReply.parse(await json({ op, request })).seq }
    } catch (error) {
      if (!(error instanceof DesktopSyncServiceError) || error.status >= 500) throw error
      switch (error.code) {
        case "stale_base":
        case "rate_limited":
        case "not_found":
          return { ok: false as const, reason: error.code }
        default:
          return { ok: false as const, reason: "refused" as const }
      }
    }
  }
  return {
    chain: {
      listKeys: async () => decodeSyncKeys(await json({ op: "listKeys" })),
      listEntries: async () => decodeSyncEntries(await json({ op: "listEntries" })).entries,
      listEntriesAfter: async (after: number) => decodeSyncEntries(await json({ op: "listEntriesAfter", after })).entries,
      listRecoveryWraps: async () => decodeRecoveryWraps(await json({ op: "listRecoveryWraps" })).wraps,
      async state() {
        const state = stateReply.parse(await json({ op: "state" }))
        return { head: state.head, currentEpoch: state.current_epoch, rotationPending: state.rotation_pending }
      },
      appendKeys: request => append("appendKeys", request),
      recoveryJoin: request => append("recoveryJoin", request),
    },
    pairing: {
      async openPending(account: string, commitment: string) {
        if (account !== descriptor.accountId) throw new DesktopSyncServiceError("refused", 403)
        return decodeSyncPending(await json({ op: "openPending", commitment }))
      },
      async readPending(id: string) {
        try {
          return decodeSyncPending(await json({ op: "readPending", id }))
        } catch (error) {
          if (error instanceof DesktopSyncServiceError && error.code === "not_found") return null
          throw error
        }
      },
      async listPending() {
        const { pending } = pendingList.parse(await json({ op: "listPending" }))
        return pending.map(decodeSyncPending)
      },
      answerPending: async (id, principal, nonce) => decodeSyncPending(await json({ op: "answerPending", id, principal, nonce })),
      revealPending: async (id, principal, nonce) => decodeSyncPending(await json({ op: "revealPending", id, principal, nonce })),
      async setAccountSync(enabled: boolean) {
        await json({ op: "setAccountSync", enabled })
      },
      async setDeviceSync(deviceId: string, enabled: boolean) {
        if (deviceId !== descriptor.serviceDeviceId) throw new DesktopSyncServiceError("refused", 403)
        await json({ op: "setDeviceSync", enabled })
      },
    },
    devices: async () => SyncDevices.parse(await json({ op: "devices" })).devices,
  }
}
