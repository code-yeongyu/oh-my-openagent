import { type DeviceLoginOptions, type DeviceLoginResult, loginDevice } from "./device-flow"
import { BrowserUnavailable, loginLoopback } from "./loopback"
import { ApiRefusal } from "./protocol"
import type { Session } from "./session"

/**
 * `omo login`'s two routes: the browser sign-in when one is given, else (or when no browser opens) the device code.
 * #14032: a browser sign-in refused with `machine_exists` gets the same replace decision as the device code, and an
 * accepted replacement continues as a device-code replace sign-in, since only that request carries `replace`.
 */
export async function signInByRoute(
  session: Session,
  routes: { readonly loopback?: Parameters<typeof loginLoopback>[1]; readonly device: DeviceLoginOptions },
): Promise<DeviceLoginResult> {
  if (routes.loopback !== undefined) {
    try {
      await loginLoopback(session, routes.loopback)
      return {}
    } catch (error) {
      if (error instanceof ApiRefusal && error.code === "machine_exists") {
        if (routes.device.replaceDevice === undefined || !(await routes.device.replaceDevice(error.machineDevice)))
          throw error
        return loginDevice(session, { ...routes.device, replacing: error.machineDevice })
      }
      if (!(error instanceof BrowserUnavailable)) throw error
    }
  }
  return loginDevice(session, routes.device)
}
