import { refuseSecondMachineDevice } from "./machine-device"
import { RequestFailure, SignInError } from "./protocol"
import type { DeviceServiceHandoff, Session } from "./session"

/** The account service did not answer its health probe, so no sign-in started. */
export class AccountsUnreachable extends SignInError {}

// Probe the service before anything user-visible (a browser tab, a device code) so an
// unreachable or unhealthy service fails at once instead of after a dead page and a wait.
async function ensureServiceAvailable(session: Pick<Session, "request">, api: string): Promise<unknown> {
  try {
    return await session.request("/v1/health", { method: "GET" })
  } catch (error) {
    if (!(error instanceof SignInError)) throw error
    // No usable HTTP answer (DNS, refused, TLS, timeout, non-JSON body): the client can't tell a
    // service that hasn't launched from an offline network, so it names both.
    if (error instanceof RequestFailure) {
      throw new AccountsUnreachable(
        `Can't reach OmO accounts at ${api}. The service may not be available yet, or your network, proxy or certificate settings are blocking it.`,
      )
    }
    throw new AccountsUnreachable(`OmO accounts at ${api} aren't available right now. Try again later.`)
  }
}

/**
 * Login order (#6503): refuse a second device from the stored sign-in and the machine's device service before
 * `/v1/health`. A logged-out computer is the one that waits on accounts being reachable.
 */
export async function beginLogin(
  session: Pick<Session, "accessSnapshot" | "request">,
  deviceService: DeviceServiceHandoff | undefined,
  api: string,
): Promise<unknown> {
  await refuseSecondMachineDevice(session, deviceService)
  return ensureServiceAvailable(session, api)
}

