import { setTimeout } from "node:timers/promises"
import { generateDeviceKeys } from "./device-keys"
import {
  ApiRefusal,
  type ChooseDevice,
  deviceCodeSchema,
  deviceTokenGrantSchema,
  jsonRequest,
  type MachineDevice,
  parseReply,
  type Platform,
  SignInError,
} from "./protocol"
import type { Session } from "./session"

export type DisplayCode = { readonly verificationUri: string; readonly userCode: string; readonly matchingCode: string }
export type DeviceLoginOptions = {
  readonly name: string
  readonly platform: Platform
  readonly show: (code: DisplayCode) => void
  readonly chooseDevice: ChooseDevice
  /**
   * #14032: asked once when the service answers `machine_exists`, with the earlier device it names. True starts a new
   * device code that asks the service to replace that device; false (or no callback) keeps the refusal.
   */
  readonly replaceDevice?: (existing: MachineDevice) => Promise<boolean>
  /** A replacement already agreed on another route (the browser sign-in's `machine_exists`): start with it. */
  readonly replacing?: MachineDevice
  /** This machine's hardware digest (#6503), sent only when the service advertises machine identity. */
  readonly machineDigest?: string
  readonly now?: () => number
  readonly sleep?: (ms: number) => Promise<void>
}

/** What a finished device sign-in reports: the earlier device the service signed out when this one replaced it. */
export type DeviceLoginResult = { readonly replacedDeviceId?: string }

const REPLACE_UNSUPPORTED =
  "This OmO service can't replace a computer's earlier device yet. Remove that device on the Devices page of your OmO account, then run omo login again."
const REPLACE_MISMATCH =
  "The device chosen on the approval page is not this computer's earlier device, so nothing was replaced or saved. Run omo login again to start over, and choose this computer's device when replacing."

export async function loginDevice(session: Session, options: DeviceLoginOptions): Promise<DeviceLoginResult> {
  await session.ready()
  const keys = generateDeviceKeys()
  if (options.replacing !== undefined) return replaceEarlierDevice(session, options, keys, options.replacing)
  try {
    return await authorizeDevice(session, options, keys)
  } catch (error) {
    // #6503: this machine already has its device. Never retried as is, never a reason to remove or inherit that device
    // here: only the service replaces it, after the person approves the replacement on its page (#14032).
    if (!(error instanceof ApiRefusal) || error.code !== "machine_exists") throw error
    if (options.replaceDevice === undefined || !(await options.replaceDevice(error.machineDevice))) throw error
    return replaceEarlierDevice(session, options, keys, error.machineDevice)
  }
}

async function replaceEarlierDevice(
  session: Session,
  options: DeviceLoginOptions,
  keys: ReturnType<typeof generateDeviceKeys>,
  existing: MachineDevice,
): Promise<DeviceLoginResult> {
  try {
    return await authorizeDevice(session, options, keys, {
      ...(existing.deviceId === undefined ? {} : { deviceId: existing.deviceId }),
    })
  } catch (error) {
    // An older service ignores `replace` and refuses the same way again.
    if (error instanceof ApiRefusal && error.code === "machine_exists") throw new SignInError(REPLACE_UNSUPPORTED)
    throw error
  }
}

async function authorizeDevice(
  session: Session,
  options: DeviceLoginOptions,
  keys: ReturnType<typeof generateDeviceKeys>,
  replace?: { readonly deviceId?: string },
): Promise<DeviceLoginResult> {
  const minted = parseReply(
    deviceCodeSchema,
    await session.request(
      "/v1/device/code",
      jsonRequest({
        client: { name: options.name, platform: options.platform },
        ...(replace === undefined ? {} : { replace }),
      }),
    ),
  )
  const uri = new URL(minted.verificationUri)
  if (uri.protocol !== "https:" && !(uri.protocol === "http:" && uri.hostname === "127.0.0.1" && uri.port !== "")) {
    throw new SignInError("The service returned an unsafe verification URL.")
  }
  options.show({
    verificationUri: minted.verificationUri,
    userCode: minted.userCode,
    matchingCode: minted.matchingCode,
  })
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? ((ms) => setTimeout(ms, undefined, { signal: session.signal }))
  const expiresAt = Date.parse(minted.expiresAt)
  let interval = minted.intervalSeconds * 1000
  while (now() < expiresAt) {
    await sleep(Math.min(interval, expiresAt - now()))
    session.signal?.throwIfAborted()
    if (now() >= expiresAt) break
    try {
      const { replacedDeviceId, ...grant } = parseReply(
        deviceTokenGrantSchema,
        await session.request(
          "/v1/device/token",
          jsonRequest({
            deviceCode: minted.deviceCode,
            ...keys.public,
            ...(options.machineDigest === undefined ? {} : { machineDigest: options.machineDigest }),
          }),
        ),
      )
      await session.save({ ...grant, ...keys.private })
      return replacedDeviceId === undefined ? {} : { replacedDeviceId }
    } catch (error) {
      if (!(error instanceof ApiRefusal)) throw error
      if (error.code === "machine_exists") throw error
      if (error.status === 400 && error.code === "authorization_pending") continue
      if (error.status === 400 && error.code === "slow_down") {
        interval += 5000
        continue
      }
      if (error.status === 429) {
        interval = error.retryDelay(now(), Math.min(60_000, interval + 5000))
        continue
      }
      if (error.detail !== undefined) {
        if (await session.removeForLimit(error, options.chooseDevice)) continue
        throw new SignInError("Sign-in cancelled. No device was removed.")
      }
      if (error.replaceMismatch) throw new SignInError(REPLACE_MISMATCH)
      if (["access_denied", "expired_token", "invalid_grant"].includes(error.code)) {
        throw new SignInError("Device sign-in was denied or expired. Run omo login again for a new code.")
      }
      throw error
    }
  }
  throw new SignInError("Device sign-in expired. Run omo login again for a new code.")
}
