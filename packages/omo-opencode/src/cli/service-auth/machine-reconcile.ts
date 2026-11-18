import { createHash, createPrivateKey, sign } from "node:crypto"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { syncRequestHeaders } from "@oh-my-opencode/memory-core/sync-capabilities"
import { z } from "zod"
import { deviceName, isGeneratedDeviceName } from "./device-name"
import { readMachineDigest } from "./machine-digest"
import { ApiRefusal, type Credentials, nonempty } from "./protocol"

/** The first line of the bytes a held-device binding signs (omo-service contract `MACHINE_BIND_CONTEXT`). */
const MACHINE_BIND_CONTEXT = "omo-machine-bind-v1"

/** The longest a refresh's caller waits for the post-refresh device fix-up before it gets its token anyway. */
export const DEVICE_FIXUP_BUDGET_MS = 5_000

/** How long a machine_exists refusal for one device and digest holds before a later refresh asks again. */
const MACHINE_EXISTS_RETRY_MS = 7 * 24 * 60 * 60 * 1000

const deviceListSchema = z.object({ devices: z.array(z.unknown()) })
const ownDeviceSchema = z.object({
  id: nonempty,
  name: nonempty,
  current: z.boolean().optional(),
  revokedAt: z.string().nullable(),
  machineBound: z.boolean().optional(),
})
const refusalNoteSchema = z.object({ key: z.string(), at: z.number() })

/** This machine as the service should know it: its hardware digest (undefined when none can be read) and its name. */
export type MachineIdentity = {
  readonly digest: () => Promise<string | undefined>
  readonly name: () => string
  /** The fix-up's overall budget; DEVICE_FIXUP_BUDGET_MS when absent. */
  readonly budgetMs?: number
}

export const thisMachine: MachineIdentity = { digest: () => readMachineDigest(), name: () => deviceName() }

/** Where a machine_exists refusal is remembered: a non-secret note beside the account's signed-out marker. */
export const machineRefusalPath = (home: string, credential: string): string =>
  join(home, ".omo", "account-state", `${credential}.machine-exists.json`)

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error))

// The note holds a hash, so neither the device id nor the hardware digest is written in the clear.
const refusalKey = (deviceId: string, digest: string): string =>
  createHash("sha256").update(`${deviceId}\n${digest}`, "utf8").digest("hex")

/** Settles as `work` does, or rejects once `signal` aborts, so a step that cannot be cancelled is never waited past it. */
function bounded<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise<T>((resolve, reject) => {
    const stop = () => reject(signal.reason)
    signal.addEventListener("abort", stop, { once: true })
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", stop))
  })
}

async function refusedRecently(path: string, key: string, nowMs: number, signal: AbortSignal): Promise<boolean> {
  const text = await readFile(path, { encoding: "utf8", signal }).catch(() => null)
  if (text === null) return false
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return false
  }
  const note = refusalNoteSchema.safeParse(value)
  return note.success && note.data.key === key && nowMs - note.data.at < MACHINE_EXISTS_RETRY_MS
}

async function rememberRefusal(path: string, key: string, nowMs: number, signal: AbortSignal): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const staging = `${path}.${process.pid}.tmp`
  await writeFile(staging, JSON.stringify({ key, at: nowMs }), { mode: 0o600, signal })
  // The note only lands while the fix-up still runs; a budget that ran out meanwhile leaves no file behind.
  if (signal.aborted) await rm(staging, { force: true })
  else await rename(staging, path)
}

/**
 * After a refresh (#13651): a device signed in before machine identity binds itself to this machine once, and a label
 * omo generated becomes the machine name once. The service's own device list says whether either is still owed, so a
 * later refresh sends nothing. Never throws and never ends, revokes or replaces the sign-in: a machine_exists refusal is
 * logged once and remembered locally, so later refreshes do not ask again until MACHINE_EXISTS_RETRY_MS has passed.
 * Once `signal` aborts (the fix-up budget ran out) it settles at the next step and writes and logs nothing more.
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
  readonly refusalPath: string
  readonly log: (line: string) => void
  /** The fix-up budget: every request is expected to abort on it, and the uncancellable steps are raced against it. */
  readonly signal: AbortSignal
}): Promise<void> {
  const { credentials, request, signal } = options
  const log = (line: string) => {
    if (!signal.aborted) options.log(line)
  }
  const auth = syncRequestHeaders(credentials.accessToken)
  let own: z.infer<typeof ownDeviceSchema>
  try {
    const listed = deviceListSchema.safeParse(await request("/v1/devices", { headers: auth }))
    if (!listed.success) {
      log("omo: the account's device list could not be read after a sign-in refresh.")
      return
    }
    // Only this device's row matters; an odd row of another device never blocks the fix-up.
    const row = listed.data.devices.find(
      (device) =>
        typeof device === "object" && device !== null && "id" in device && device.id === credentials.device.id,
    )
    const parsed = ownDeviceSchema.safeParse(row)
    if (!parsed.success) {
      log("omo: this device's entry in the account's device list could not be read after a sign-in refresh.")
      return
    }
    own = parsed.data
  } catch (error) {
    log(`omo: could not read this device's registration after a sign-in refresh (${describe(error)}).`)
    return
  }
  if (own.revokedAt !== null || own.current === false) return
  // A service that does not report machineBound predates the binding route; nothing is sent to it.
  if (own.machineBound === false) await bindOnce(options, auth, log)
  const name = options.machine.name()
  if (signal.aborted || !isGeneratedDeviceName(own.name) || own.name === name) return
  try {
    await request(`/v1/devices/${encodeURIComponent(own.id)}`, {
      method: "PATCH",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ name }),
    })
    if (!signal.aborted) await options.renamed(name)
  } catch (error) {
    log(`omo: could not rename this device to this computer's name (${describe(error)}).`)
  }
}

async function bindOnce(
  options: Parameters<typeof reconcileDevice>[0],
  auth: Readonly<Record<string, string>>,
  log: (line: string) => void,
): Promise<void> {
  const { credentials, signal } = options
  try {
    const machineDigest = await bounded(options.machine.digest(), signal)
    if (machineDigest === undefined) return
    const key = refusalKey(credentials.device.id, machineDigest)
    if (await refusedRecently(options.refusalPath, key, options.nowMs, signal)) return
    const accountId =
      credentials.accountId ?? credentials.owner?.accountId ?? (await options.accountOf(credentials.accessToken))
    if (accountId === undefined) throw new Error("the service named no account for this sign-in")
    const issuedAt = Math.floor(options.nowMs / 1000)
    const signed = [
      MACHINE_BIND_CONTEXT,
      options.api,
      accountId,
      credentials.device.id,
      machineDigest,
      String(issuedAt),
    ]
    const signingKey = createPrivateKey({
      key: Buffer.from(credentials.signingPrivateKey, "base64"),
      format: "der",
      type: "pkcs8",
    })
    const signature = sign(null, Buffer.from(signed.join("\n"), "utf8"), signingKey).toString("base64url")
    try {
      await options.request("/v1/devices/current/machine", {
        method: "PUT",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({ machineDigest, issuedAt, signature }),
      })
    } catch (error) {
      if (!(error instanceof ApiRefusal && error.code === "machine_exists")) throw error
      log(
        "omo: another OmO device already holds this computer, so this sign-in was left as it is. Remove the duplicate device on the Devices page of your OmO account.",
      )
      if (signal.aborted) return
      await rememberRefusal(options.refusalPath, key, options.nowMs, signal).catch((cause: unknown) =>
        log(`omo: could not remember that refusal (${describe(cause)}).`),
      )
    }
  } catch (error) {
    log(`omo: could not bind this device to this computer (${describe(error)}); the next sign-in refresh retries.`)
  }
}
