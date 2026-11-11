import { existsSync } from "node:fs"
import {
  connectDeviceService,
  type DeviceService,
  deviceServiceEndpointPath,
  deviceServiceStateDir,
  forgetDeviceService,
  handDeviceKeys,
} from "../device-service-core/src/index.ts"
import { connectOrNotRunning } from "../device-service-core/src/hand-device-keys.ts"
import type { Credentials } from "../omo-opencode/src/cli/service-auth/protocol"
import type { DeviceServiceHandoff } from "../omo-opencode/src/cli/service-auth/session"
import packageJson from "./package.json" with { type: "json" }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null

/** The account a sign-in belongs to, asked of the service with the token the sign-in holds in memory. */
async function accountOf(api: string, credentials: Credentials, doFetch: typeof fetch): Promise<string> {
  if (credentials.accountId !== undefined) return credentials.accountId
  const response = await doFetch(`${api}/v1/me`, { headers: { authorization: `Bearer ${credentials.accessToken}` } })
  if (!response.ok) throw new Error(`the account read failed (${response.status})`)
  const body: unknown = await response.json()
  const id = isRecord(body) && isRecord(body["account"]) ? body["account"]["id"] : undefined
  if (typeof id !== "string" || id === "") throw new Error("the account read named no account")
  return id
}

/**
 * The omo CLI's device service hand-off (design D r9 sections 4-5): a fresh sign-in's keys and account go to a running
 * device service from memory; every local end of a sign-in makes it forget the device. It never installs or starts a
 * service and never reads the credential store. A failure is one line on `log` and never fails the sign-in or sign-out:
 * relayd also refuses to mint while omo's signed-out marker exists.
 */
export function cliDeviceServiceHandoff(options: {
  readonly api: string
  readonly log: (line: string) => void
  readonly stateDir?: string
  readonly connect?: () => Promise<DeviceService>
  readonly fetch?: typeof fetch
}): DeviceServiceHandoff {
  const stateDir = options.stateDir ?? deviceServiceStateDir()
  const connect = options.connect ?? (() => connectDeviceService({ version: packageJson.version, stateDir }))
  const doFetch = options.fetch ?? fetch
  const report = (what: string) => (error: unknown) => {
    options.log(`OmO device service: ${what} did not complete (${error instanceof Error ? error.message : String(error)}).`)
  }
  return {
    adopt: async credentials => {
      // No running service: nothing to hand over, so not even the account is asked for.
      if (!existsSync(deviceServiceEndpointPath(stateDir))) return
      try {
        const account = await accountOf(options.api, credentials, doFetch)
        await handDeviceKeys({
          stateDir, connect, when: "always", log: options.log,
          credential: {
            device: { id: credentials.device.id, name: credentials.device.name },
            signingPrivateKey: credentials.signingPrivateKey,
            sealingPrivateKey: credentials.sealingPrivateKey,
            account,
          },
        })
      } catch (error) {
        report("handing this sign-in to it")(error)
      }
    },
    machineDevice: async () => {
      if (!existsSync(deviceServiceEndpointPath(stateDir))) return null
      try {
        const service = await connectOrNotRunning(connect, options.log)
        if (service === "not_running") return null
        try {
          const status = await service.status()
          return status.state === "sign_in_required" ? null : status.device
        } finally {
          service.close()
        }
      } catch (error) {
        report("reading this computer's device")(error)
        return null
      }
    },
    forget: async () => {
      try {
        await forgetDeviceService({ stateDir, connect, log: options.log })
      } catch (error) {
        report("forgetting this device")(error)
      }
    },
  }
}
