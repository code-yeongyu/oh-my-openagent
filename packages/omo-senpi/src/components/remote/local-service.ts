import { connectDeviceService, type DeviceService } from "@oh-my-opencode/device-service-core/device-service"

/**
 * This device's device service over its local API, for `omo remote`'s local-only path (#13414, guard S2): the remote
 * module opens every device-service connection, so a surface asks for one here instead of calling device-service-core.
 */
export const connectLocalService = (options: {
  readonly version: string
  readonly stateDir: string
}): Promise<DeviceService> => connectDeviceService(options)
