import { existsSync, unwatchFile, watchFile } from "node:fs"
import { homedir } from "node:os"

import { credentialId } from "../keystore"
import { serviceOrigin } from "../protocol"
import { signedOutMarkerPath } from "../signed-out-marker"
import { accountRecordPath, readAccountRecord } from "./account-record"
import { createJwksSource } from "./jwks-source"
import { checkPresenterAttestation, rawEd25519Key, verifyIssuerSignature, type IssuerKey } from "./issuer-token"

// Structural copy of senpi's `PresenterAccountAuthority` (packages/coding-agent/src/modes/rpc/mcp-presenter-account.ts).
export type PresenterAttestationRefusal =
  | "attestation_malformed"
  | "attestation_signature"
  | "attestation_audience"
  | "attestation_expired"
  | "attestation_key_mismatch"
export type PresenterAttestationResult =
  | { readonly ok: true; readonly attestation: { readonly acc: string; readonly dev: string; readonly dname: string; readonly exp: number; readonly jti: string } }
  | { readonly ok: false; readonly reason: PresenterAttestationRefusal }
export interface PresenterAccountAuthority {
  hostAccount(): string | undefined
  verify(token: string, publicKeySpkiDer: Uint8Array, nowS: number): Promise<PresenterAttestationResult>
  onAccountChange(listener: () => void): () => void
}

// Stat polling, not fs.watch: a revocation signal must not depend on file events, which some macOS hosts never
// deliver. A missed change is still bounded by the attestation lifetime, because re-attestation re-reads the account.
const ACCOUNT_POLL_MS = 1_000

// Verifies under the cached key set, and once more after a refresh when the token names a key not yet seen.
async function signedClaims(token: string, keys: { current(): Promise<readonly IssuerKey[]>; refresh(): Promise<readonly IssuerKey[]> }) {
  const first = await verifyIssuerSignature(token, await keys.current())
  return first.kind === "unknown_key" ? verifyIssuerSignature(token, await keys.refresh()) : first
}

export function createOmoPresenterAccountAuthority(options: {
  readonly api: string
  readonly home?: string
  readonly fetch?: (url: string, init: RequestInit) => Promise<Response>
}): PresenterAccountAuthority {
  const origin = serviceOrigin(options.api)
  const home = options.home ?? homedir()
  const credential = credentialId(origin)
  const recordPath = accountRecordPath(home, credential)
  const markerPath = signedOutMarkerPath(home, credential)
  const keys = createJwksSource({ url: `${origin}/.well-known/omo-service/jwks.json`, fetch: options.fetch ?? fetch })
  const issuer = `${origin}/v1`

  const hostAccount = (): string | undefined =>
    existsSync(markerPath) ? undefined : readAccountRecord(recordPath)?.accountId

  const listeners = new Set<() => void>()
  let seen: string | undefined
  const observe = (): void => {
    const now = hostAccount()
    if (now === seen) return
    seen = now
    for (const listener of [...listeners]) listener()
  }


  return {
    hostAccount,
    async verify(token, publicKeySpkiDer, nowS) {
      const rawKey = rawEd25519Key(publicKeySpkiDer)
      if (rawKey === undefined) return { ok: false, reason: "attestation_key_mismatch" }
      const signed = await signedClaims(token, keys)
      if (signed.kind !== "verified") return { ok: false, reason: signed.kind === "malformed" ? "attestation_malformed" : "attestation_signature" }
      const checked = await checkPresenterAttestation(signed.claims, issuer, nowS, rawKey)
      if (!checked.ok) return checked
      const { acc, dev, dname, exp, jti } = checked
      return { ok: true, attestation: { acc, dev, dname, exp, jti } }
    },
    onAccountChange(listener) {
      if (listeners.size === 0) {
        seen = hostAccount()
        for (const path of [recordPath, markerPath]) watchFile(path, { interval: ACCOUNT_POLL_MS, persistent: false }, observe)
      }
      listeners.add(listener)
      return () => {
        if (!listeners.delete(listener) || listeners.size > 0) return
        for (const path of [recordPath, markerPath]) unwatchFile(path, observe)
      }
    },
  }
}
