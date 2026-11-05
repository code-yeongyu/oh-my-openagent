import { existsSync, unwatchFile, watchFile } from "node:fs"
import { homedir } from "node:os"

import { createCredentialStore, credentialId } from "../keystore"
import { serviceOrigin } from "../protocol"
import { createSession } from "../session"
import { signedOutMarkerPath } from "../signed-out-marker"
import { accountRecordPath, readAccountRecord } from "./account-record"
import { createJwksSource } from "./jwks-source"
import { checkPresenterAttestation, checkStepUpToken, rawEd25519Key, verifyIssuerSignature, type IssuerKey, type StepUpCheck } from "./issuer-token"
import { mintSecretHostToken, type SecretHostTokenRequest } from "./secret-host-mint"

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
  mintSecretHostToken?(request: SecretHostTokenRequest): Promise<string>
  verifySecretAnswer?(token: string, presenterSpki: Uint8Array, req: string, nowS: number): Promise<StepUpCheck>
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
  /** The signed-in device's access token for `account`, read in process; never env, argv, a file or a log. */
  readonly accessToken?: (account: string) => Promise<string>
  readonly now?: () => number
}): PresenterAccountAuthority {
  const origin = serviceOrigin(options.api)
  const home = options.home ?? homedir()
  const credential = credentialId(origin)
  const recordPath = accountRecordPath(home, credential)
  const markerPath = signedOutMarkerPath(home, credential)
  const keys = createJwksSource({ url: `${origin}/.well-known/omo-service/jwks.json`, fetch: options.fetch ?? fetch })
  const issuer = `${origin}/v1`
  const nowS = (): number => Math.floor((options.now ?? Date.now)() / 1000)
  const accessToken = options.accessToken ?? (account =>
    createSession({ api: origin, store: createCredentialStore(origin, { home }), home })
      .accessToken(current => current.accountId === account))

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
    mintSecretHostToken(request) {
      return mintSecretHostToken(request, {
        origin, issuer, account: hostAccount(), accessToken, fetch: options.fetch ?? fetch, keys: keys.current, nowS,
      })
    },
    async verifySecretAnswer(token, presenterSpki, req, now) {
      const rawKey = rawEd25519Key(presenterSpki)
      if (rawKey === undefined) return { ok: false, reason: "stepup_key_mismatch" }
      const signed = await signedClaims(token, keys)
      if (signed.kind !== "verified") return { ok: false, reason: signed.kind === "malformed" ? "stepup_malformed" : "stepup_signature" }
      return checkStepUpToken(signed.claims, issuer, now, rawKey, req)
    },
  }
}
