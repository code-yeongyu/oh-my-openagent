/**
 * Headers memory-core sends on every sync request (A3 engine contract sec 8 and A1.1-M3).
 * `SYNC_CONTRACT_VERSION` copies omo-service `packages/contract/src/version.ts` CONTRACT_VERSION at e39e23ad;
 * that file is outside the vendored sync-format set. `SYNC_CAPABILITIES` lives here, beside the parser, so only
 * a build that parses recovery-phrase keys says so; the service floor reads it, never the contract version.
 */
export const SYNC_CONTRACT_VERSION = "1.44.0"
export const SYNC_CAPABILITIES = "phrase"

export const syncHeaders = (): Readonly<Record<string, string>> => ({
  "omo-contract-version": SYNC_CONTRACT_VERSION,
  "omo-sync-capabilities": SYNC_CAPABILITIES,
})
