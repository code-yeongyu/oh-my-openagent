import { homedir } from "node:os"
import { deviceServiceStateDir } from "@oh-my-opencode/device-service-core/state-dir"
import {
  relayStatus,
  type RelayStatusResult,
  RelayTransportError,
  type StatusState,
} from "../../../../vendor/bunshin-ts-relay/index.js"
import { ok, type OmoResult, refused } from "../result"

export type DeviceServiceStatusPort = (options: { readonly stateDir: string }) => Promise<RelayStatusResult>

export type DeviceServiceStatus = {
  /** `not_running` when no device service listens on this machine; otherwise the service's own state. */
  readonly state: StatusState | "not_running"
  readonly connected: boolean
  readonly device: { readonly id: string; readonly name: string } | null
}

export type DeviceServiceApi = { readonly status: () => Promise<OmoResult<DeviceServiceStatus>> }

export function createDeviceServiceApi(options: {
  readonly env: Readonly<Record<string, string | undefined>>
  readonly home?: string
  readonly status?: DeviceServiceStatusPort
}): DeviceServiceApi {
  const status = options.status ?? relayStatus
  return {
    async status() {
      // The state dir rule the fleet SDK's transport picker uses (#13597), so both read the same service.
      const stateDir = deviceServiceStateDir(process.platform, options.env, options.home ?? homedir())
      try {
        const answer = await status({ stateDir })
        return ok({
          state: answer.state ?? "not_running",
          connected: answer.connected,
          device: answer.device === null ? null : { id: answer.device.id, name: answer.device.name },
        })
      } catch (error) {
        return refused(
          "device_service_unavailable",
          "this machine's device service did not prove itself",
          "restart the device service, then retry",
          { code: error instanceof RelayTransportError ? error.code : "unknown" },
        )
      }
    },
  }
}
