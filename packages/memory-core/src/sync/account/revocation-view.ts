// What a rotator needs from the account's device list (sync-design section 7, rotation on revoke):
// which sync principals are on a revoked row, which are listed at all, and which one is this device.
// Only `current`, `revokedAt` and `syncPrincipal` are read. Every other field is ignored, so a device
// on a platform or of a kind this client does not know never stops a rotation. A row whose three
// fields do not parse vouches for nothing; it does not fail the view.

import { AccountHttpError } from "./http.ts"

export type RevocationView =
  | { readonly kind: "unusable" }
  | {
      readonly kind: "usable"
      /** The principal on the `current: true` row. */
      readonly self: string
      readonly selfRevoked: boolean
      readonly revoked: ReadonlySet<string>
      readonly listed: ReadonlySet<string>
    }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

export function parseRevocationView(body: unknown): RevocationView {
  const rows = isRecord(body) ? body["devices"] : undefined
  if (!Array.isArray(rows)) return { kind: "unusable" }
  const revoked = new Set<string>()
  const listed = new Set<string>()
  let self: { readonly principal: string; readonly revoked: boolean } | null = null
  for (const row of rows) {
    if (!isRecord(row)) continue
    const principal = row["syncPrincipal"]
    const revokedAt = row["revokedAt"]
    if (typeof principal !== "string" || principal === "" || (revokedAt !== null && typeof revokedAt !== "string"))
      continue
    listed.add(principal)
    if (revokedAt !== null) revoked.add(principal)
    if (row["current"] === true && self === null) self = { principal, revoked: revokedAt !== null }
  }
  return self === null
    ? { kind: "unusable" }
    : { kind: "usable", self: self.principal, selfRevoked: self.revoked, revoked, listed }
}

/** The view over `GET /v1/devices` for a device holding its own bearer token (the CLI credential). */
export function createRevocationView(options: {
  readonly baseUrl: string
  readonly token: () => string | Promise<string>
  readonly fetch?: typeof fetch
}): () => Promise<RevocationView> {
  const doFetch = options.fetch ?? fetch
  return async () => {
    const response = await doFetch(`${options.baseUrl}/v1/devices`, {
      headers: { authorization: `Bearer ${await options.token()}` },
    })
    if (!response.ok) throw new AccountHttpError(response.status >= 500 ? "unavailable" : "refused", response.status)
    return parseRevocationView(await response.json())
  }
}
