import { syncRequestHeaders } from "@oh-my-opencode/memory-core/sync-capabilities"
import { z } from "zod"
import { ApiRefusal, jsonRequest } from "./protocol"
import type { Session } from "./session"

// The account's devices as `GET /v1/devices` lists them, read with this device's sign-in. One reader for every caller:
// the account machine interface (`omo-native/account-devices.ts`) and the shipped omo SDK.

const timestamp = z.string().min(1)
const listedSchema = z.object({
  devices: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      kind: z.string().optional(),
      platform: z.string().optional(),
      createdAt: timestamp.optional(),
      lastSeenAt: timestamp.optional(),
      current: z.boolean().optional(),
      revokedAt: timestamp.nullable(),
      machineBound: z.boolean().optional(),
    }),
  ),
})
type Listed = z.infer<typeof listedSchema>["devices"][number]

/** A device the account still lists as signed in; `current` is the device whose token made the request. */
export type LiveDevice = {
  readonly id: string
  readonly name: string
  readonly kind?: string
  readonly platform?: string
  readonly createdAt?: string
  readonly lastSeenAt?: string
  readonly machineBound?: boolean
  readonly current: boolean
}

const live = (device: Listed): LiveDevice => ({
  id: device.id,
  name: device.name,
  ...(device.kind === undefined ? {} : { kind: device.kind }),
  ...(device.platform === undefined ? {} : { platform: device.platform }),
  ...(device.createdAt === undefined ? {} : { createdAt: device.createdAt }),
  ...(device.lastSeenAt === undefined ? {} : { lastSeenAt: device.lastSeenAt }),
  ...(device.machineBound === undefined ? {} : { machineBound: device.machineBound }),
  current: device.current === true,
})

export async function listLiveDevices(session: Pick<Session, "accessToken" | "request">): Promise<LiveDevice[]> {
  const access = await session.accessToken()
  const body = await session.request("/v1/devices", { headers: syncRequestHeaders(access) })
  return listedSchema
    .parse(body)
    .devices.filter((device) => device.revokedAt === null)
    .map(live)
}

export type RevokeOutcome =
  | { readonly kind: "revoked"; readonly device: LiveDevice }
  | { readonly kind: "not_found" }
  | { readonly kind: "this_device" | "confirmation_mismatch" | "still_live"; readonly device: LiveDevice }

/**
 * Signs ANOTHER device of this account out, by id (#13189): the refusals are decided on a fresh list before any request,
 * and the revoke counts only once the account no longer lists the device. `confirmName`, when given, must equal the
 * device's current name. `thisDeviceId` is the stored credential's device: a service that omits or misreports `current`
 * never gets this device revoked.
 */
export async function revokeDevice(
  session: Pick<Session, "accessToken" | "request">,
  target: { readonly id: string; readonly thisDeviceId: string | undefined; readonly confirmName?: string },
): Promise<RevokeOutcome> {
  const device = (await listLiveDevices(session)).find((listed) => listed.id === target.id)
  if (device === undefined) return { kind: "not_found" }
  if (device.current || device.id === target.thisDeviceId) return { kind: "this_device", device }
  if (target.confirmName !== undefined && target.confirmName !== device.name)
    return { kind: "confirmation_mismatch", device }
  const access = await session.accessToken()
  try {
    await session.request(`/v1/devices/${encodeURIComponent(device.id)}`, {
      method: "DELETE",
      headers: syncRequestHeaders(access),
    })
  } catch (error) {
    // Another caller revoked it between the list and the delete: the account answers 404 for a device it no longer has.
    if (!(error instanceof ApiRefusal && error.status === 404)) throw error
  }
  const stillLive = (await listLiveDevices(session)).some((listed) => listed.id === device.id)
  return stillLive ? { kind: "still_live", device } : { kind: "revoked", device }
}

/** Renames a device of this account; the service answers 404 `not_found` for an id the account does not have. */
export async function renameDevice(
  session: Pick<Session, "accessToken" | "request">,
  id: string,
  name: string,
): Promise<void> {
  const access = await session.accessToken()
  await session.request(`/v1/devices/${encodeURIComponent(id)}`, {
    ...jsonRequest({ name }),
    method: "PATCH",
    headers: { ...syncRequestHeaders(access), "content-type": "application/json" },
  })
}
