import { NotSentError } from "./not-sent-error.ts"
import type { LocalApiClient } from "./local-api/client.ts"
import { compareVersions } from "./release/version.ts"

/** The first service version that answers session.endpoints with the host's primary engine endpoint (relay daemon 0.1.11). */
export const ENDPOINT_PRIMARY_MIN_SERVICE_VERSION = "0.1.11"

/**
 * omo#14195: the engine endpoint a remote create or open goes to: the host's primary, else its only endpoint. Several
 * endpoints and no primary means its own engine is unlisted; the rest are owner shards or other agent dirs' engines,
 * possibly too old to admit a later cross-device send, so nothing is opened there.
 */
export async function engineEndpointOf(client: LocalApiClient, device: string): Promise<string> {
  const asksPrimary = compareVersions(client.welcome.service_version, ENDPOINT_PRIMARY_MIN_SERVICE_VERSION) >= 0
  const listed = await client.request("session.endpoints", asksPrimary ? { device, primary: true } : { device })
  if (listed.primary !== undefined) return listed.primary
  const [only, ...rest] = listed.endpoints
  if (only === undefined) throw new NotSentError("unsupported", "the device lists no engine endpoint")
  if (rest.length === 0) return only
  throw new NotSentError(
    "host_not_answering",
    `${device} lists ${listed.endpoints.length} engine endpoints and names none as its own engine, so nothing was opened`,
    { action: `Start or restart omo on ${device} so its own engine is listed, then retry.` },
  )
}
