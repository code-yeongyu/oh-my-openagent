import { z } from "zod"
import type { DesktopSyncAccount, DesktopSyncDescriptor, DesktopSyncOperation, SyncOperationAuthority } from "@oh-my-opencode/memory-core/sync-engine"
import type { DeviceKeyring } from "@oh-my-opencode/memory-core/keyring"
import { desktopSyncAccountPorts } from "./desktopSyncAccountPorts"
import { desktopSyncBoundary } from "./desktopSyncBoundary"
import { openDesktopSyncOperation } from "./desktopSyncOperation"
import { DesktopSyncServiceError, SyncDescriptor } from "./desktopSyncPortSchema"
import { DesktopSyncRefused, type DesktopSyncEvent, type DesktopSyncWire } from "./desktopSyncProtocol"
import { desktopSyncReplicationPort } from "./desktopSyncReplicationPort"

export type DesktopSyncEngineWire = DesktopSyncWire & {
  readonly signal: AbortSignal
  close(): void
  onEvent(listener: (event: DesktopSyncEvent) => void): () => void
}

const signature = z.strictObject({ op: z.literal("sign"), signature: z.string() })
const unsealed = z.strictObject({ op: z.literal("unseal"), plaintext: z.string() })
const signedAccount = z.object({ account: z.string() })
const bytes = (value: string, length?: number) => {
  const decoded = Buffer.from(value, "base64url")
  if (decoded.toString("base64url") !== value || (length !== undefined && decoded.length !== length)) {
    throw new DesktopSyncServiceError("malformed_reply", 200)
  }
  return new Uint8Array(decoded)
}

const sameDescriptor = (a: DesktopSyncDescriptor, b: DesktopSyncDescriptor) => a.generation === b.generation
  && a.incarnation === b.incarnation && a.accountId === b.accountId && a.serviceOrigin === b.serviceOrigin
  && a.serviceDeviceId === b.serviceDeviceId && a.syncPrincipalId === b.syncPrincipalId
  && a.publicKeys.signing === b.publicKeys.signing && a.publicKeys.sealing === b.publicKeys.sealing

/** Install this source in the engine's composition root, never the CLI credential source. */
export async function openDesktopSyncAccount(wire: DesktopSyncEngineWire, home?: string): Promise<DesktopSyncAccount> {
  const descriptor: DesktopSyncDescriptor = SyncDescriptor.parse(await wire.request({ op: "descriptor" }))
  const boundary = desktopSyncBoundary(descriptor, wire.signal, home)
  const accountAuthority: SyncOperationAuthority = {
    signal: wire.signal,
    admit(effect) {
      if (wire.signal.aborted) throw new DesktopSyncRefused()
      return effect()
    },
    boundary,
  }
  const open = async (authority: SyncOperationAuthority) => {
    const operation = await openDesktopSyncOperation(wire, {
      signal: AbortSignal.any([wire.signal, authority.signal]),
      admit: effect => accountAuthority.admit(() => authority.admit(effect)),
    })
    const call = (data: Readonly<Record<string, unknown>>) => operation.request({ op: "service", data })
    const keyring: DeviceKeyring = {
      principal: () => ({ kind: "device", id: descriptor.syncPrincipalId }),
      publicKeys: () => descriptor.publicKeys,
      async sign(request) {
        if (request.purpose !== "object-digest") {
          // Main signs a record only for the captured account; refuse a foreign one before it reaches the channel.
          const parsed = signedAccount.safeParse(JSON.parse(Buffer.from(request.canonicalJson).toString("utf8")))
          if (!parsed.success || parsed.data.account !== descriptor.accountId) throw new DesktopSyncRefused()
        }
        const data = request.purpose === "object-digest"
          ? { op: "sign", purpose: request.purpose, digest: Buffer.from(request.digest).toString("base64url") }
          : { op: "sign", purpose: request.purpose, canonicalJson: Buffer.from(request.canonicalJson).toString("base64url") }
        return bytes(signature.parse(await operation.request({ op: "keyring", data })).signature, 64)
      },
      async unseal(wrap, binding) {
        if (binding.account !== descriptor.accountId) throw new DesktopSyncRefused()
        const reply = unsealed.parse(await operation.request({
          op: "keyring",
          data: { op: "unseal", wrap: Buffer.from(wrap).toString("base64url"), binding },
        }))
        return bytes(reply.plaintext)
      },
    }
    return { ...desktopSyncAccountPorts(call, descriptor), handle: operation.handle, call, close: operation.close, keyring }
  }
  const background = await open(accountAuthority)
  const transport = desktopSyncReplicationPort(background.call, handlers => {
    let active = true
    let subscription: Awaited<ReturnType<typeof open>> | undefined
    const remove = wire.onEvent(event => {
      if (!active || wire.signal.aborted || event.event === "retired" || event.handle !== subscription?.handle) return
      if (event.event === "advanced") handlers.onAdvanced(event.head)
      else handlers.onConnected(event.connected)
    })
    void open(accountAuthority)
      .then(async operation => {
        subscription = operation
        if (!active) return operation.close()
        await operation.call({ op: "subscribe" })
      })
      .catch(() => {
        if (active && !wire.signal.aborted) handlers.onConnected(false)
      })
    return () => {
      if (!active) return
      active = false
      remove()
      if (subscription !== undefined && !wire.signal.aborted) void subscription.close().catch(() => undefined)
    }
  })
  const forOperation = async (authority: SyncOperationAuthority): Promise<DesktopSyncOperation> => {
    const operation = await open(authority)
    return { keyring: operation.keyring, chain: operation.chain, pairing: operation.pairing, devices: operation.devices, close: operation.close }
  }
  return {
    kind: "desktop",
    descriptor,
    signal: wire.signal,
    keyring: background.keyring,
    chain: background.chain,
    pairing: background.pairing,
    devices: background.devices,
    transport,
    boundary,
    forOperation,
    async isCurrent() {
      if (wire.signal.aborted) return false
      const current = SyncDescriptor.parse(await wire.request({ op: "descriptor" }))
      if (wire.signal.aborted || !sameDescriptor(current, descriptor)) return false
      return boundary(() => true).then(() => true, () => false)
    },
  }
}
