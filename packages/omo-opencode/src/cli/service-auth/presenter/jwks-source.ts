import type { IssuerKey as Jwk } from "./issuer-token"

// Same timings as relayd's key source: a set older than the TTL refreshes, never within the floor of the last fetch.
const JWKS_TTL_MS = 5 * 60_000
const JWKS_MIN_REFETCH_MS = 30_000
const JWKS_FETCH_TIMEOUT_MS = 3_000

const parseJwks = (body: unknown): Jwk[] => {
  if (typeof body !== "object" || body === null || !("keys" in body) || !Array.isArray(body.keys)) return []
  const keys: Jwk[] = []
  for (const entry of body.keys as unknown[]) {
    if (typeof entry !== "object" || entry === null) continue
    const { kty, crv, x, y, kid } = entry as Record<string, unknown>
    if (kty === "EC" && crv === "P-256" && typeof x === "string" && typeof y === "string" && typeof kid === "string")
      keys.push({ kty, crv, x, y, kid })
  }
  return keys
}

export function createJwksSource(options: {
  readonly url: string
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>
  readonly clock?: () => number
}): { readonly current: () => Promise<readonly Jwk[]>; readonly refresh: () => Promise<readonly Jwk[]> } {
  const clock = options.clock ?? Date.now
  let keys: readonly Jwk[] = []
  let fetchedAt = Number.NEGATIVE_INFINITY
  let inFlight: Promise<readonly Jwk[]> | undefined

  const load = (): Promise<readonly Jwk[]> => {
    if (inFlight !== undefined) return inFlight
    fetchedAt = clock()
    inFlight = (async () => {
      try {
        const response = await options.fetch(options.url, {
          redirect: "error",
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(JWKS_FETCH_TIMEOUT_MS),
        })
        const fresh = response.ok ? parseJwks(await response.json()) : []
        if (fresh.length > 0) keys = fresh
      } catch {
        // A failed fetch keeps the previous set; verification then refuses an unknown key, which fails closed.
      } finally {
        inFlight = undefined
      }
      return keys
    })()
    return inFlight
  }

  return {
    current: () => (clock() - fetchedAt >= JWKS_TTL_MS ? load() : Promise.resolve(keys)),
    refresh: () => (clock() - fetchedAt < JWKS_MIN_REFETCH_MS ? Promise.resolve(keys) : load()),
  }
}
