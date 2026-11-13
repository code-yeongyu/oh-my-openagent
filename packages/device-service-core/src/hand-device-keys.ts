import { existsSync } from "node:fs"
import {
  type DeviceCredential,
  type DeviceService,
  deviceServiceEndpointPath,
  LocalApiError,
  type Status,
} from "./device-service.ts"

/** Why a connection to the device service's endpoint failed; the first word of the log line. */
type ConnectFailure = "dead_endpoint" | "refused" | "unreadable" | "timed_out" | "failed"

const DEAD_ENDPOINT_CODES = new Set(["ENOENT", "ECONNREFUSED", "ECONNRESET", "EPIPE"])

const connectFailure = (error: unknown): { readonly cause: ConnectFailure; readonly detail: string } => {
  const detail = error instanceof Error ? error.message : String(error)
  if (error instanceof LocalApiError) {
    if (error.code === "refused" || error.code === "server_proof_invalid") return { cause: "refused", detail }
    // read_failed is a session-history read failing on a live attach, not an unreadable endpoint: it falls to "failed".
    if (error.code === "insecure_state_dir") return { cause: "unreadable", detail }
    if (error.code === "handshake_timeout" || error.code === "request_timeout") return { cause: "timed_out", detail }
    return { cause: "failed", detail }
  }
  const code = error instanceof Error && "code" in error ? String(error.code) : ""
  return { cause: DEAD_ENDPOINT_CODES.has(code) ? "dead_endpoint" : "failed", detail }
}

/**
 * A relayd that died can leave its endpoint file behind, so a connect failure is "no service running": logged once and
 * never thrown, so it can never fail or block a sign-in or a sign-out. The memory device session re-adopts later, once a
 * service answers.
 */
export const connectOrNotRunning = async (
  connect: () => Promise<DeviceService>,
  log: ((line: string) => void) | undefined,
): Promise<DeviceService | "not_running"> => {
  try {
    return await connect()
  } catch (error) {
    // dead_endpoint: nothing listens (a dead service left its file); refused: it refused us or failed the mutual proof;
    // unreadable: its state dir or token could not be read safely; timed_out: it did not answer in time.
    const { cause, detail } = connectFailure(error)
    log?.(`OmO device service: ${cause}, treated as not running (${detail}).`)
    return "not_running"
  }
}

/** A device credential a client already holds in memory for its own work, with the account it belongs to. */
export type HeldDeviceCredential = DeviceCredential & { readonly account: string }

// relayd reports a device it has not adopted (or cannot mint for, `not_adopted`) as no device / sign_in_required.
const adopted = (status: Status): boolean => status.device !== null && status.state !== "sign_in_required"

/**
 * Hands a held credential's account and keys to a RUNNING device service (design D r9 sections 3-4). It never installs
 * or starts one and never reads a credential store: the caller already holds `credential` in memory.
 * `when: "always"` is a fresh sign-in; `when: "not_adopted"` is the re-adopt, sent only while the service reports no
 * adopted device.
 */
export const handDeviceKeys = async (options: {
  readonly stateDir: string
  readonly connect: () => Promise<DeviceService>
  readonly credential: HeldDeviceCredential
  readonly when: "always" | "not_adopted"
  /** One line when an endpoint file is there but no service answers it. */
  readonly log?: (line: string) => void
}): Promise<"adopted" | "already_adopted" | "not_running"> => {
  if (!existsSync(deviceServiceEndpointPath(options.stateDir))) return "not_running"
  const service = await connectOrNotRunning(options.connect, options.log)
  if (service === "not_running") return "not_running"
  try {
    if (options.when === "not_adopted" && adopted(await service.status())) return "already_adopted"
    await service.adopt(options.credential)
    return "adopted"
  } finally {
    service.close()
  }
}
