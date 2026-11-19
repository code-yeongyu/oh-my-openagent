import { homedir } from "node:os"
import { LocalApiError, readDeviceServiceStatus } from "@oh-my-opencode/device-service-core"
import { deviceServiceStateDir } from "@oh-my-opencode/device-service-core/state-dir"
import { createOmoNativeProductConfig } from "../../telemetry/product-identity"
import { ok, type OmoResult, refused } from "../result"

type ServiceStatus = Exclude<Awaited<ReturnType<typeof readDeviceServiceStatus>>, "not_running" | "no_answer">

export type DeviceServiceStatusPort = (options: {
  readonly stateDir: string
  readonly signal?: AbortSignal
}) => Promise<Pick<ServiceStatus, "state" | "device"> | "not_running" | "no_answer">

export type DeviceServiceStatus = {
  /**
   * `not_running` when no device service listens on this machine, `no_answer` when one is there but did not answer in
   * time (unknown, not offline); otherwise the service's own state.
   */
  readonly state: ServiceStatus["state"] | "not_running" | "no_answer"
  readonly connected: boolean
  readonly device: { readonly id: string; readonly name: string } | null
}

export type DeviceServiceApi = {
  /** `signal` stops the wait: the answer is then `no_answer`. */
  readonly status: (options?: { readonly signal?: AbortSignal }) => Promise<OmoResult<DeviceServiceStatus>>
}

const readStatus: DeviceServiceStatusPort = ({ stateDir, signal }) =>
  readDeviceServiceStatus({
    stateDir,
    version: createOmoNativeProductConfig().packageVersion,
    ...(signal === undefined ? {} : { signal }),
  })

export function createDeviceServiceApi(options: {
  readonly env: Readonly<Record<string, string | undefined>>
  readonly home?: string
  readonly status?: DeviceServiceStatusPort
}): DeviceServiceApi {
  const status = options.status ?? readStatus
  return {
    async status(callOptions = {}) {
      // The state dir rule the fleet SDK's transport picker uses (#13597), so both read the same service.
      const stateDir = deviceServiceStateDir(process.platform, options.env, options.home ?? homedir())
      try {
        const answer = await status({
          stateDir,
          ...(callOptions.signal === undefined ? {} : { signal: callOptions.signal }),
        })
        if (answer === "not_running" || answer === "no_answer")
          return ok({ state: answer, connected: false, device: null })
        return ok({
          state: answer.state,
          connected: answer.state === "connected",
          device: answer.device === null ? null : { id: answer.device.id, name: answer.device.name },
        })
      } catch (error) {
        return refused(
          "device_service_unavailable",
          "this machine's device service did not prove itself",
          "restart the device service, then retry",
          { code: error instanceof LocalApiError ? error.code : "unknown" },
        )
      }
    },
  }
}
