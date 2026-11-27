import { LocalApiError, readDeviceServiceStatus } from "@oh-my-opencode/device-service-core"
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
  readonly stateDir: () => string
  readonly status?: DeviceServiceStatusPort
}): DeviceServiceApi {
  const status = options.status ?? readStatus
  return {
    async status(callOptions = {}) {
      try {
        const answer = await status({
          stateDir: options.stateDir(),
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
