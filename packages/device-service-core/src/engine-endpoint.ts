import { NotSentError } from "./not-sent-error.ts"
import type { LocalApiClient } from "./local-api/client.ts"
import { compareVersions } from "./release/version.ts"

/** The first service version that answers session.endpoints with the host's primary engine endpoint (relay daemon 0.1.11). */
const ENDPOINT_PRIMARY_MIN_SERVICE_VERSION = "0.1.11"

/**
 * omo#14195: the device names no engine endpoint as its own. Every create fails the same way until
 * omo runs on that device again, or its device service (or this one) is updated to name a primary, so it is its own
 * refusal, never a transient code a caller would simply retry.
 */
export class NoPrimaryEndpointError extends NotSentError {
  constructor(device: string, listed: number) {
    super(
      "unsupported",
      `${device} lists ${listed} engine endpoint(s) and names none as its own engine; nothing was opened`,
      {
        action: `Start or restart omo on ${device}; if that does not help, update the device service on both devices.`,
      },
    )
  }
}

/**
 * omo#14195: the engine endpoint a remote create or open goes to: the host's primary. Asked and not named, the host's
 * own engine is unlisted, and whatever it does list (owner shards, other agent dirs' engines, possibly too old to admit a
 * later cross-device send) is never opened on, even alone. Only a service too old to ask falls back to a lone endpoint.
 */
export async function engineEndpointOf(client: LocalApiClient, device: string): Promise<string> {
  const asksPrimary = compareVersions(client.welcome.service_version, ENDPOINT_PRIMARY_MIN_SERVICE_VERSION) >= 0
  const listed = await client.request("session.endpoints", asksPrimary ? { device, primary: true } : { device })
  if (listed.primary !== undefined) return listed.primary
  const [only, ...rest] = listed.endpoints
  if (only === undefined) throw new NotSentError("unsupported", "the device lists no engine endpoint")
  if (!asksPrimary && rest.length === 0) return only
  throw new NoPrimaryEndpointError(device, listed.endpoints.length)
}

/**
 * omo#14271: every engine endpoint key `device` lists, and the one it names as its own (0.1.11+). The primary is named
 * by key, never by position: a host may list it last (the omo#14195 contract test lists `[OTHER_DIR, SHARD, PRIMARY]`).
 */
export type EngineEndpoints = {
  readonly keys: readonly string[]
  /** The host's primary engine endpoint, when it names one (0.1.11+). Absent: it names none, or predates the field. */
  readonly primary?: string
}

/**
 * omo#14271: the engine endpoints a read-only lookup may go to. Asked with `primary: true` where the service knows it, so
 * the caller can skip the primary by its key instead of guessing it is `endpoints[0]`.
 */
export async function engineEndpointsOf(client: LocalApiClient, device: string): Promise<EngineEndpoints> {
  const asksPrimary = compareVersions(client.welcome.service_version, ENDPOINT_PRIMARY_MIN_SERVICE_VERSION) >= 0
  const listed = await client.request("session.endpoints", asksPrimary ? { device, primary: true } : { device })
  return { keys: listed.endpoints, ...(listed.primary === undefined ? {} : { primary: listed.primary }) }
}
