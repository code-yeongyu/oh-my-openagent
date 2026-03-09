/**
 * Shared utilities for accessing OpenCode SDK internal client structure.
 *
 * Provides safe access to the SDK's internal `_client` (v1) or `client` (v2) properties.
 */

export type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null
}

/**
 * Extracts the internal SDK client from a wrapper client.
 *
 * Supports both v1 SDK (client._client) and v2 SDK (client.client).
 *
 * @param client - The SDK client wrapper
 * @returns The internal client record, or null if not accessible
 */
export function getInternalClient(client: unknown): UnknownRecord | null {
  if (!isRecord(client)) {
    return null
  }

  // Support both v1 SDK (client._client) and v2 SDK (client.client)
  // Prefer the candidate that has getConfig or setConfig (the actual transport client)
  const candidates = [client["_client"], client["client"]].filter(isRecord)
  for (const candidate of candidates) {
    if (typeof candidate["getConfig"] === "function" || typeof candidate["setConfig"] === "function") {
      return candidate
    }
  }
  return candidates[0] ?? null
}

/**
 * Type guard for Record<string, unknown>.
 *
 * @param value - The value to check
 * @returns True if the value is a Record<string, unknown>
 */
export { isRecord }
