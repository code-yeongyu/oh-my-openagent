import { createPrivateKey, sign } from "node:crypto"
import { z } from "zod"
import { deviceName, isGeneratedDeviceName } from "./device-name"
import { readMachineDigest } from "./machine-digest"
import { ApiRefusal, type Credentials, nonempty } from "./protocol"

/** The first line of the bytes a held-device binding signs (omo-service contract `MACHINE_BIND_CONTEXT`). */
const MACHINE_BIND_CONTEXT = "omo-machine-bind-v1"

const ownDeviceSchema = z.object({
  devices: z.array(
    z.object({
      id: nonempty,
      name: nonempty,
      current: z.boolean(),
      revokedAt: z.string().nullable(),
      machineBound: z.boolean().optional(),
    }),
  ),
})

/** This machine as the service should know it: its hardware digest (undefined when none can be read) and its name. */
export type MachineIdentity = {
  readonly digest: () => Promise<string | undefined>
  readonly name: () => string
}

export const thisMachine: MachineIdentity = { digest: () => readMachineDigest(), name: () => deviceName() }

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/**
 * After a refresh (#13651): a device signed in before machine identity binds itself to this machine once, and a label
 * omo generated becomes the machine name once. The service's own device list says whether either is still owed, so a
 * later refresh sends nothing. Never throws and never ends, revokes or replaces the sign-in: a refusal (machine_exists
 * included) is one log line and leaves everything stored as it was.
 */
export async function reconcileDevice(options: {
  readonly api: string
  readonly credentials: Credentials
  readonly machine: MachineIdentity
  readonly nowMs: number
  readonly request: (path: string, init: RequestInit) => Promise<unknown>
  readonly accountOf: (access: string) => Promise<string | undefined>
  /** Records the new name in the stored credential after the service accepted it. */
  readonly renamed: (name: string) => Promise<void>
  readonly log: (line: string) => void
}): Promise<void> {
  const { credentials, request, log } = options
  const auth = { authorization: `Bearer ${credentials.accessToken}` }
  let own: z.infer<typeof ownDeviceSchema>["devices"][number] | undefined
  try {
    const listed = ownDeviceSchema.safeParse(await request("/v1/devices", { headers: auth }))
    if (!listed.success) return
    own = listed.data.devices.find(
      (device) => device.current && device.revokedAt === null && device.id === credentials.device.id,
    )
  } catch (error) {
    log(`omo: could not read this device's registration after a sign-in refresh (${describe(error)}).`)
    return
  }
  if (own === undefined) return
  // A service that does not report machineBound predates the binding route; nothing is sent to it.
  if (own.machineBound === false) {
    try {
      await bindMachine(options, auth)
    } catch (error) {
      log(
        error instanceof ApiRefusal && error.code === "machine_exists"
          ? "omo: another OmO device already holds this computer, so this sign-in was left as it is. Remove the duplicate device on the Devices page of your OmO account."
          : `omo: could not bind this device to this computer (${describe(error)}); the next sign-in refresh retries.`,
      )
    }
  }
  const name = options.machine.name()
  if (!isGeneratedDeviceName(own.name) || own.name === name) return
  try {
    await request(`/v1/devices/${encodeURIComponent(own.id)}`, {
      method: "PATCH",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ name }),
    })
    await options.renamed(name)
  } catch (error) {
    log(`omo: could not rename this device to this computer's name (${describe(error)}).`)
  }
}

async function bindMachine(
  options: Parameters<typeof reconcileDevice>[0],
  auth: { readonly authorization: string },
): Promise<void> {
  const { credentials } = options
  const machineDigest = await options.machine.digest()
  if (machineDigest === undefined) return
  const accountId =
    credentials.accountId ?? credentials.owner?.accountId ?? (await options.accountOf(credentials.accessToken))
  if (accountId === undefined) throw new Error("the service named no account for this sign-in")
  const issuedAt = Math.floor(options.nowMs / 1000)
  const signed = [MACHINE_BIND_CONTEXT, options.api, accountId, credentials.device.id, machineDigest, String(issuedAt)]
  const key = createPrivateKey({
    key: Buffer.from(credentials.signingPrivateKey, "base64"),
    format: "der",
    type: "pkcs8",
  })
  const signature = sign(null, Buffer.from(signed.join("\n"), "utf8"), key).toString("base64url")
  await options.request("/v1/devices/current/machine", {
    method: "PUT",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ machineDigest, issuedAt, signature }),
  })
}
