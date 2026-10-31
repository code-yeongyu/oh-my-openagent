import { z } from "zod"
import { createAccountHttp, createPairingHttp } from "@oh-my-opencode/memory-core/sync-account-ports"
import type { DeviceKeyring } from "@oh-my-opencode/memory-core/keyring"
import type { DesktopSyncDescriptor, DesktopSyncOperation, SyncOperationAuthority } from "./account-source"

const devices = z.object({ devices: z.array(z.object({
  id: z.string(), name: z.string(), kind: z.enum(["desktop", "cli"]),
  platform: z.enum(["macos", "linux", "windows"]), createdAt: z.string(), lastSeenAt: z.string(),
  approximateLocation: z.string().optional(), current: z.boolean(), syncing: z.boolean(),
  revokedAt: z.string().nullable(), syncPrincipal: z.string().nullable(),
})) })

export function scopedCliKeyring(raw: DeviceKeyring, check: () => Promise<void>, authority: SyncOperationAuthority, boundary: <T>(dispatch: () => T) => Promise<T>): DeviceKeyring {
  return {
    principal: () => raw.principal(),
    publicKeys: () => raw.publicKeys(),
    async sign(request) {
      await check()
      return boundary(() => authority.admit(() => raw.sign(request)))
    },
    async unseal(wrap, binding) {
      await check()
      return boundary(() => authority.admit(() => raw.unseal(wrap, binding)))
    },
  }
}

export async function cliAccountOperation(options: {
  readonly descriptor: DesktopSyncDescriptor
  readonly lifetime: AbortSignal
  readonly isCurrent: () => Promise<boolean>
  readonly boundary: <T>(dispatch: () => T) => Promise<T>
  readonly accessToken: () => Promise<string>
  readonly keyring: DeviceKeyring
  readonly fetch: typeof fetch
}, owner: SyncOperationAuthority): Promise<DesktopSyncOperation> {
  const closed = new AbortController()
  const signal = AbortSignal.any([options.lifetime, owner.signal, closed.signal])
  const unavailable = () => new Error("The CLI sync account is no longer current.")
  const authority: SyncOperationAuthority = {
    signal,
    admit: effect => owner.admit(() => {
      if (signal.aborted) throw unavailable()
      return effect()
    }),
  }
  const check = async () => {
    if (signal.aborted || !await options.isCurrent() || signal.aborted) throw unavailable()
  }
  await check()
  const token = async () => {
    await check()
    const value = await options.accessToken()
    await check()
    return value
  }
  const doFetch: typeof fetch = Object.assign(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    await check()
    const response = await options.boundary(() => authority.admit(() => options.fetch(input, { ...init, signal })))
    await check()
    return response
  }, { preconnect: options.fetch.preconnect })
  const http = { baseUrl: options.descriptor.serviceOrigin, token, fetch: doFetch }
  const pairing = createPairingHttp(http)
  const chain = createAccountHttp(http)
  const append: typeof chain.appendKeys = request => {
    if (request.record.account !== options.descriptor.accountId) return Promise.reject(unavailable())
    return chain.appendKeys(request)
  }
  return {
    keyring: scopedCliKeyring(options.keyring, check, authority, options.boundary),
    chain: {
      ...chain,
      appendKeys: append,
      recoveryJoin: request => request.record.account === options.descriptor.accountId
        ? chain.recoveryJoin(request) : Promise.reject(unavailable()),
    },
    pairing: {
      ...pairing,
      openPending: (account, commitment) => account === options.descriptor.accountId
        ? pairing.openPending(account, commitment) : Promise.reject(unavailable()),
      setDeviceSync: (device, enabled) => device === options.descriptor.serviceDeviceId
        ? pairing.setDeviceSync(device, enabled) : Promise.reject(unavailable()),
    },
    async devices() {
      const response = await doFetch(`${http.baseUrl}/v1/devices`, { headers: { authorization: `Bearer ${await token()}` } })
      if (!response.ok) throw new Error(`Device list refused (${response.status}).`)
      const parsed = devices.safeParse(await response.json())
      await check()
      if (!parsed.success) throw new Error("The service device list is malformed.")
      return parsed.data.devices
    },
    async close() { closed.abort() },
  }
}
