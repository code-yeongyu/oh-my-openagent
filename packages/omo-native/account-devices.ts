import { z } from "zod"
import { ApiRefusal } from "../omo-opencode/src/cli/service-auth/protocol"
import type { Session } from "../omo-opencode/src/cli/service-auth/session"
import { ACCOUNT_EXIT } from "./account-show"

// `omo account devices` lists the account's live devices; `omo account devices revoke <id>` signs out ANOTHER device of
// the same account by its id (#13189), over the account API's owner-scoped `DELETE /v1/devices/:id`. It is how a dead
// device (state lost, keychain wiped, an old registration of a computer that signed in again) leaves the account: it
// cannot sign itself out. Nothing here picks a device by name or guesses which one is dead: the id is the caller's
// explicit choice, read from the list. This device ends its own sign-in with `omo logout` or `omo account forget`.

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

export interface AccountDevicesDependencies {
  readonly output: (line: string) => void
  readonly error: (line: string) => void
}

const USAGE = "omo account devices: use devices or devices revoke <id>"

const reply = (dependencies: AccountDevicesDependencies, value: unknown, code: number = ACCOUNT_EXIT.ok): number => {
  dependencies.output(JSON.stringify(value))
  return code
}

const view = (device: Listed) => ({
  id: device.id,
  name: device.name,
  ...(device.kind === undefined ? {} : { kind: device.kind }),
  ...(device.platform === undefined ? {} : { platform: device.platform }),
  ...(device.createdAt === undefined ? {} : { createdAt: device.createdAt }),
  ...(device.lastSeenAt === undefined ? {} : { lastSeenAt: device.lastSeenAt }),
  ...(device.machineBound === undefined ? {} : { machineBound: device.machineBound }),
  current: device.current === true,
})

async function liveDevices(session: Session): Promise<Listed[]> {
  const access = await session.accessToken()
  const body = await session.request("/v1/devices", { headers: { authorization: `Bearer ${access}` } })
  return listedSchema.parse(body).devices.filter((device) => device.revokedAt === null)
}

async function revoke(dependencies: AccountDevicesDependencies, session: Session, id: string): Promise<number> {
  const before = await liveDevices(session)
  const target = before.find((device) => device.id === id)
  if (target === undefined) {
    dependencies.error(`omo account devices revoke: no live device ${id} on this account (run omo account devices)`)
    return reply(dependencies, { revoked: false, error: "not_found" }, ACCOUNT_EXIT.failed)
  }
  if (target.current === true) {
    dependencies.error("omo account devices revoke: that is this device; sign it out with omo logout")
    return reply(dependencies, { revoked: false, error: "this_device", device: view(target) }, ACCOUNT_EXIT.invalid)
  }
  const access = await session.accessToken()
  try {
    await session.request(`/v1/devices/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${access}` },
    })
  } catch (error) {
    // Another caller revoked it between the list and the delete: the account answers 404 for a device it no longer has.
    if (!(error instanceof ApiRefusal && error.status === 404)) throw error
  }
  // Read back: the revoke counts only once the account no longer lists the device as live.
  const after = await liveDevices(session)
  if (after.some((device) => device.id === id)) {
    dependencies.error(`omo account devices revoke: ${id} is still listed as live after the revoke`)
    return reply(dependencies, { revoked: false, error: "still_live", device: view(target) }, ACCOUNT_EXIT.failed)
  }
  return reply(dependencies, { revoked: true, device: view(target) })
}

export async function runDevicesVerb(
  dependencies: AccountDevicesDependencies,
  session: Session,
  flags: readonly string[],
): Promise<number> {
  if (flags.length === 0) return reply(dependencies, { devices: (await liveDevices(session)).map(view) })
  const [action, id, ...rest] = flags
  if (action !== "revoke" || id === undefined || id === "" || id.startsWith("--") || rest.length > 0) {
    dependencies.error(USAGE)
    return ACCOUNT_EXIT.invalid
  }
  return revoke(dependencies, session, id)
}
