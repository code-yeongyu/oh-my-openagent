import { existsSync } from "node:fs"
import {
  connectDeviceService,
  type DeviceService,
  deviceServiceEndpointPath,
  deviceServiceStateDir,
  forgetDeviceService,
  handDeviceKeys,
  LocalApiError,
} from "../device-service-core/src/index.ts"
import type { MachineDeviceService } from "../omo-opencode/src/cli/service-auth/machine-binding"
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
    options.log(
      `OmO device service: ${what} did not complete (${error instanceof Error ? error.message : String(error)}).`,
    )
  }
  return {
    adopt: async (credentials) => {
      // No running service: nothing to hand over, so not even the account is asked for.
      if (!existsSync(deviceServiceEndpointPath(stateDir))) return
      try {
        const account = await accountOf(options.api, credentials, doFetch)
        await handDeviceKeys({
          stateDir,
          connect,
          when: "always",
          log: options.log,
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
    forget: async () => {
      try {
        await forgetDeviceService({ stateDir, connect, log: options.log })
      } catch (error) {
        report("forgetting this device")(error)
      }
    },
  }
}

// A device service in either state holds no live identity a sign-in could collide with: it was told to forget, or its
// session ended and it waits for a sign-in (the key-proven re-bind path).
const NOT_HOLDING = new Set(["signed_out", "sign_in_required"])

/**
 * This machine's device service as a CLI sign-in binds to it (omo-service#1016): the machine hash for the account's
 * salt and the identity it already holds. Answers undefined when no service runs, when it predates
 * device.machine_binding, or when it cannot be reached; the sign-in then binds from its own read of the machine id.
 */
export function cliMachineDeviceService(options: {
  readonly log: (line: string) => void
  readonly stateDir?: string
  readonly connect?: () => Promise<DeviceService>
}): MachineDeviceService {
  const stateDir = options.stateDir ?? deviceServiceStateDir()
  const connect = options.connect ?? (() => connectDeviceService({ version: packageJson.version, stateDir }))
  const withService = async <T>(what: string, use: (service: DeviceService) => Promise<T>): Promise<T | undefined> => {
    if (!existsSync(deviceServiceEndpointPath(stateDir))) return undefined
    let service: DeviceService | undefined
    try {
      service = await connect()
      return await use(service)
    } catch (error) {
      const older = error instanceof LocalApiError && (error.code === "unknown_type" || error.code === "unsupported")
      if (!older)
        options.log(
          `OmO device service: ${what} did not complete (${error instanceof Error ? error.message : String(error)}).`,
        )
      return undefined
    } finally {
      service?.close()
    }
  }
  return {
    binding: (machineSalt) =>
      withService("binding this sign-in to the machine", async (service) => {
        const answer = await service.machineBinding(machineSalt)
        return {
          machineHash: answer.machine_hash,
          device:
            answer.device === null
              ? null
              : {
                  id: answer.device.id,
                  signingKey: answer.device.signing_public_key,
                  sealingKey: answer.device.sealing_public_key,
                },
          mergeDeviceIds: answer.merge_device_ids,
        }
      }),
    heldDevice: () =>
      withService("reading its device", async (service) => {
        const status = await service.status()
        return status.device === null || NOT_HOLDING.has(status.state) ? null : status.device.id
      }),
  }
}
