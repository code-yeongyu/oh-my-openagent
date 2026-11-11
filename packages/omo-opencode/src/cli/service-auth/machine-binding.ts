import { execFile } from "node:child_process"
import { createHmac } from "node:crypto"
import { readFile } from "node:fs/promises"
import { generateDeviceKeys, publicKeysOf } from "./device-keys"
import { ApiRefusal, type Credentials, SignInError } from "./protocol"

// One machine is one OmO device (omo-service#1016, owner ruling OO1447): the machine's single device service (relayd)
// holds the device, and a CLI sign-in binds to it instead of registering a device of its own. The service keys the
// device on machine_hash = unpadded base64url(HMAC-SHA256(account salt, "omo-machine-v1\0" + profile + "\0" + raw id)).
// The raw OS machine id never leaves this machine.

/** The identity this machine's device service holds, with its public keys in the service's encoding. */
export type HeldMachineDevice = { readonly id: string; readonly signingKey: string; readonly sealingKey: string }

/** relayd's answer to device.machine_binding. */
export type RelaydMachineBinding = {
  readonly machineHash: string | null
  readonly device: HeldMachineDevice | null
  readonly mergeDeviceIds: readonly string[]
}

/**
 * This machine's device service as a sign-in sees it. `binding` is undefined when no device service runs or it predates
 * device.machine_binding; `heldDevice` then names the live device it holds (null: none, undefined: no service).
 */
export type MachineDeviceService = {
  readonly binding: (machineSalt: string) => Promise<RelaydMachineBinding | undefined>
  readonly heldDevice: () => Promise<string | null | undefined>
}

export type MachineIdSources = {
  readonly platform: NodeJS.Platform
  readonly readText: (path: string) => Promise<string | undefined>
  readonly run: (file: string, args: readonly string[]) => Promise<string | undefined>
}

const defaultSources: MachineIdSources = {
  platform: process.platform,
  readText: (path) =>
    readFile(path, "utf8").then(
      (text) => text,
      () => undefined,
    ),
  run: (file, args) =>
    new Promise((resolve) => {
      execFile(file, [...args], { timeout: 5_000, windowsHide: true }, (error, stdout) =>
        resolve(error === null ? stdout : undefined),
      )
    }),
}

/** The OS machine id read the same way relayd reads it (relay-daemon MID1); none means the device registers unbound. */
export async function readMachineId(sources: MachineIdSources = defaultSources): Promise<string | undefined> {
  if (sources.platform === "linux") {
    for (const path of ["/etc/machine-id", "/var/lib/dbus/machine-id"]) {
      const id = (await sources.readText(path))?.trim()
      if (id !== undefined && id !== "" && id !== "uninitialized") return id
    }
    return undefined
  }
  if (sources.platform === "darwin") {
    // Absolute: a child spawned without PATH would fail a bare `ioreg` (#11819).
    const out = await sources.run("/usr/sbin/ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"])
    return /"IOPlatformUUID" = "([^"]+)"/.exec(out ?? "")?.[1]
  }
  if (sources.platform === "win32") {
    const out = await sources.run("reg", ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"])
    return /MachineGuid\s+REG_SZ\s+(\S+)/.exec(out ?? "")?.[1]
  }
  return undefined
}

/** OMO_DEVICE_PROFILE: unset or empty is the default profile; a name that is not a plain token binds nothing. */
function deviceProfileOf(env: Readonly<Record<string, string | undefined>>): string | undefined {
  const profile = env.OMO_DEVICE_PROFILE ?? ""
  return profile === "" || /^[A-Za-z0-9._-]{1,64}$/.test(profile) ? profile : undefined
}

export function machineHash(machineSalt: string, profile: string, rawId: string): string {
  return createHmac("sha256", Buffer.from(machineSalt, "base64url"))
    .update(`omo-machine-v1\0${profile}\0${rawId}`)
    .digest("base64url")
}

const MACHINE_SALT = /^[A-Za-z0-9_-]{43}$/

/** The hash computed in this process, for a machine whose device service is absent or too old to compute it. */
export function localMachineHash(
  env: Readonly<Record<string, string | undefined>>,
  sources: MachineIdSources = defaultSources,
) {
  return {
    available: async () => deviceProfileOf(env) !== undefined && (await readMachineId(sources)) !== undefined,
    hash: async (machineSalt: string): Promise<string | undefined> => {
      const profile = deviceProfileOf(env)
      const rawId = profile === undefined ? undefined : await readMachineId(sources)
      return profile === undefined || rawId === undefined ? undefined : machineHash(machineSalt, profile, rawId)
    },
  }
}
export type LocalMachineHash = ReturnType<typeof localMachineHash>

export const HELD_BY_DEVICE_SERVICE =
  "This computer is already signed in to OmO through its device service (the OmO desktop app's sign-in). " +
  "omo uses that sign-in and does not register a second device. Sign in from the OmO desktop app, or sign out there first."

const MACHINE_MISMATCH =
  "The device keys on this computer belong to an OmO device registered for another computer. Run omo logout, then omo login."

const keysEqual = (credentials: Credentials, held: HeldMachineDevice): boolean => {
  const own = publicKeysOf(credentials)
  return own !== undefined && own.signingKey === held.signingKey && own.sealingKey === held.sealingKey
}

/**
 * The keys and binding fields one sign-in presents. Without a machine binding (no readable machine id, or no binding
 * wired) it is today's sign-in: fresh keys, adopted by the device service after the grant. With one, the sign-in reuses
 * the keys this machine already holds, so the service maps it to the machine's existing device instead of adding one.
 */
export type MachineSignIn = {
  readonly keys: ReturnType<typeof generateDeviceKeys>
  /** Whether the device-code request advertises client.machineBinding. */
  readonly advertise: boolean
  /** Fields for the token or exchange request; empty until the service asked for the hash. */
  readonly fields: () => { readonly machineHash?: string; readonly mergeDeviceIds?: readonly string[] }
  /** Whether the grant goes to the device service; false when it already holds exactly these keys. */
  readonly adopt: () => boolean
  /** Handles a binding refusal: true when the same approved code should be polled again. */
  readonly retry: (error: unknown) => Promise<boolean>
}

export async function prepareMachineSignIn(options: {
  readonly stored: Credentials | null
  readonly local: LocalMachineHash | undefined
  readonly deviceService: MachineDeviceService | undefined
}): Promise<MachineSignIn> {
  const { stored, local, deviceService } = options
  if (local === undefined || !(await local.available())) {
    return {
      keys: generateDeviceKeys(),
      advertise: false,
      fields: () => ({}),
      adopt: () => true,
      retry: async () => false,
    }
  }
  const reused = stored === null ? undefined : publicKeysOf(stored)
  const keys =
    stored !== null && reused !== undefined
      ? {
          public: reused,
          private: { signingPrivateKey: stored.signingPrivateKey, sealingPrivateKey: stored.sealingPrivateKey },
        }
      : generateDeviceKeys()
  // The device the presented keys already name, if any: never asked to be folded into itself.
  const presented = reused === undefined ? undefined : stored?.device.id
  let bound: { readonly machineHash: string; readonly mergeDeviceIds: readonly string[] } | undefined
  let adopt = true
  return {
    keys,
    advertise: true,
    adopt: () => adopt,
    fields: () =>
      bound === undefined
        ? {}
        : {
            machineHash: bound.machineHash,
            ...(bound.mergeDeviceIds.length === 0 ? {} : { mergeDeviceIds: bound.mergeDeviceIds }),
          },
    retry: async (error) => {
      if (!(error instanceof ApiRefusal)) return false
      if (error.code === "machine_mismatch") throw new SignInError(MACHINE_MISMATCH)
      const salt = error.machineSalt
      if (
        error.code !== "machine_hash_required" ||
        salt === undefined ||
        !MACHINE_SALT.test(salt) ||
        bound !== undefined
      )
        return false
      const relayd = await deviceService?.binding(salt)
      let hash: string | undefined
      const merge = new Set<string>()
      if (relayd !== undefined) {
        // The device service holds this machine's identity: present exactly its keys, or refuse rather than mint.
        if (relayd.device !== null) {
          if (stored === null || reused === undefined || !keysEqual(stored, relayd.device))
            throw new SignInError(HELD_BY_DEVICE_SERVICE)
          adopt = false
        }
        hash = relayd.machineHash ?? undefined
        for (const id of relayd.mergeDeviceIds) merge.add(id)
      } else {
        const held = await deviceService?.heldDevice()
        if (held !== undefined && held !== null) {
          if (presented !== held) throw new SignInError(HELD_BY_DEVICE_SERVICE)
          adopt = false
        }
      }
      hash ??= await local.hash(salt)
      if (hash === undefined)
        throw new SignInError("This computer's machine id could not be read, so OmO cannot bind this sign-in to it.")
      if (stored !== null && stored.device.id !== presented) merge.add(stored.device.id)
      if (presented !== undefined) merge.delete(presented)
      bound = { machineHash: hash, mergeDeviceIds: [...merge].slice(0, 16) }
      return true
    },
  }
}
