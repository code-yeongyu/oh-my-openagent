import { setTimeout } from "node:timers/promises"
import { type MachineSignIn, prepareMachineSignIn } from "./machine-binding"
import {
  ApiRefusal,
  type ChooseDevice,
  deviceCodeSchema,
  grantSchema,
  jsonRequest,
  parseReply,
  type Platform,
  SignInError,
} from "./protocol"
import type { Session } from "./session"

const unbound = async (): Promise<MachineSignIn> =>
  prepareMachineSignIn({ stored: null, local: undefined, deviceService: undefined })

export type DisplayCode = { readonly verificationUri: string; readonly userCode: string; readonly matchingCode: string }
export async function loginDevice(
  session: Session,
  options: {
    readonly name: string
    readonly platform: Platform
    readonly show: (code: DisplayCode) => void
    readonly chooseDevice: ChooseDevice
    /** The machine binding (omo-service#1016); absent, the sign-in registers unbound as before. */
    readonly machine?: (session: Session) => Promise<MachineSignIn>
    readonly now?: () => number
    readonly sleep?: (ms: number) => Promise<void>
  },
): Promise<void> {
  await session.ready()
  const machine = await (options.machine ?? unbound)(session)
  const keys = machine.keys
  const minted = parseReply(
    deviceCodeSchema,
    await session.request(
      "/v1/device/code",
      jsonRequest({
        client: { name: options.name, platform: options.platform, ...(machine.advertise ? { machineBinding: 1 } : {}) },
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
      const grant = parseReply(
        grantSchema,
        await session.request(
          "/v1/device/token",
          jsonRequest({
            deviceCode: minted.deviceCode,
            ...keys.public,
            ...machine.fields(),
          }),
        ),
      )
      await session.save({ ...grant, ...keys.private }, { adopt: machine.adopt() })
      return
    } catch (error) {
      if (!(error instanceof ApiRefusal)) throw error
      if (await machine.retry(error)) continue
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
      if (["access_denied", "expired_token", "invalid_grant"].includes(error.code)) {
        throw new SignInError("Device sign-in was denied or expired. Run omo login again for a new code.")
      }
      throw error
    }
  }
  throw new SignInError("Device sign-in expired. Run omo login again for a new code.")
}
