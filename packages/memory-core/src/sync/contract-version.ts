/**
 * Headers memory-core sends on every sync request (A3 engine contract sec 8 and A1.1-M3).
 * `SYNC_CONTRACT_VERSION` copies omo-service `packages/contract/src/version.ts` CONTRACT_VERSION at e39e23ad;
 * that file is outside the vendored sync-format set. `SYNC_CAPABILITIES` lives here, beside the parser, so only
 * a build that parses recovery-phrase keys says so; the service floor reads it, never the contract version.
 */
export const SYNC_CONTRACT_VERSION = "1.44.0"
export const SYNC_CAPABILITIES = "phrase"

/**
 * The routes the service's client floor guards: the `/v1/sync/*` families (keys, pending, recovery, entries,
 * batches, state, objects, uploads). There a request that does not declare the phrase capability is refused
 * 426 client_update_required for a phrase account (#13691). Account routes (`/v1/me`, `/v1/devices`,
 * `/v1/account/*`) are not floored today, and their clients use syncRequestHeaders all the same.
 */
export const FLOORED_ROUTE_PREFIX = "/v1/sync/"

/** Whether a request to `path` would be refused by the floor: a floored route without this build's contract headers. */
export const missesSyncContract = (path: string, headers: Headers): boolean =>
  path.startsWith(FLOORED_ROUTE_PREFIX) &&
  !(
    headers.get("omo-contract-version") === SYNC_CONTRACT_VERSION &&
    (headers.get("omo-sync-capabilities") ?? "")
      .split(",")
      .map((capability) => capability.trim())
      .includes(SYNC_CAPABILITIES)
  )

/**
 * The headers of every sync-path request: the contract headers and the device's bearer token, built only
 * here so no client can send one without the other. The service's floor refuses a request from a phrase
 * account 426 when it lacks the phrase capability (#13691).
 */
export const syncRequestHeaders = (token: string): Record<string, string> => ({
  "omo-contract-version": SYNC_CONTRACT_VERSION,
  "omo-sync-capabilities": SYNC_CAPABILITIES,
  authorization: `Bearer ${token}`,
})
