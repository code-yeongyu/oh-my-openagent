// Offline checks of the account issuer's ES256 tokens, written from the D11 phase-1 design (section 2.2). Each token
// kind pins its own audience and type as code constants, so no other token signed by the same keys passes.

export interface IssuerKey {
  readonly kty: "EC"
  readonly crv: "P-256"
  readonly x: string
  readonly y: string
  readonly kid: string
}

const SKEW_S = 60
const PRESENTER = { aud: "omo-mcp-presenter", typ: "mcp_presenter", maxLifeS: 900 } as const

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | undefined {
  if (text === "" || !/^[A-Za-z0-9_-]+$/.test(text) || text.length % 4 === 1) return undefined
  return new Uint8Array(Buffer.from(text, "base64url"))
}

function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url")
}

function decodeSegment(segment: string): Record<string, unknown> | undefined {
  const raw = fromBase64Url(segment)
  if (!raw) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw))
  } catch {
    return undefined
  }
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined
}

const SPKI_ED25519_HEADER = Uint8Array.of(0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00)

/** The 32-byte Ed25519 key inside a 44-byte SPKI DER, or undefined for any other key. */
export function rawEd25519Key(spki: Uint8Array): Uint8Array | undefined {
  if (spki.length !== SPKI_ED25519_HEADER.length + 32) return undefined
  for (let index = 0; index < SPKI_ED25519_HEADER.length; index += 1) if (spki[index] !== SPKI_ED25519_HEADER[index]) return undefined
  return spki.subarray(SPKI_ED25519_HEADER.length)
}

/** RFC 7638 thumbprint of an Ed25519 public key as an OKP JWK (RFC 8037): members in lexical order, no spaces. */
export async function okpThumbprint(rawKey: Uint8Array): Promise<string> {
  const canonical = `{"crv":"Ed25519","kty":"OKP","x":"${toBase64Url(rawKey)}"}`
  return toBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical))))
}

export type SignatureOutcome =
  | { readonly kind: "verified"; readonly claims: Record<string, unknown> }
  | { readonly kind: "malformed" | "unknown_key" | "bad_signature" }

/** Verifies a compact ES256 JWS under the published key its `kid` names. Untrusted input never throws. */
export async function verifyIssuerSignature(token: string, keys: readonly IssuerKey[]): Promise<SignatureOutcome> {
  const segments = token.split(".")
  if (segments.length !== 3) return { kind: "malformed" }
  const [headerText = "", claimsText = "", signatureText = ""] = segments
  const header = decodeSegment(headerText)
  const claims = decodeSegment(claimsText)
  const signature = fromBase64Url(signatureText)
  if (header?.["alg"] !== "ES256" || claims === undefined || signature === undefined) return { kind: "malformed" }
  const published = keys.find(candidate => candidate.kid === header["kid"])
  if (published === undefined) return { kind: "unknown_key" }
  try {
    const key = await crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", x: published.x, y: published.y }, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"])
    const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, signature, new TextEncoder().encode(`${headerText}.${claimsText}`))
    return ok ? { kind: "verified", claims } : { kind: "bad_signature" }
  } catch {
    return { kind: "unknown_key" }
  }
}

const displayText = (value: unknown): value is string => typeof value === "string" && /^[^\p{Cc}]{1,256}$/u.test(value)
const nonEmpty = (value: unknown): value is string => typeof value === "string" && value.length > 0
const whole = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value)
const digest32 = (value: unknown): value is string => typeof value === "string" && fromBase64Url(value)?.length === 32
const confirmationKey = (claims: Record<string, unknown>): unknown => {
  const cnf = claims["cnf"]
  return typeof cnf === "object" && cnf !== null ? (cnf as Record<string, unknown>)["jkt"] : undefined
}

type Lifetime = "ok" | "not_yet_valid" | "too_long_lived" | "expired"
function lifetime(iat: number, exp: number, nowS: number, maxLifeS: number): Lifetime {
  if (iat > nowS + SKEW_S) return "not_yet_valid"
  if (exp - iat > maxLifeS || exp - nowS > maxLifeS + SKEW_S) return "too_long_lived"
  return exp <= nowS ? "expired" : "ok"
}

export type AttestationCheck =
  | { readonly ok: true; readonly acc: string; readonly dev: string; readonly dname: string; readonly exp: number; readonly jti: string }
  | { readonly ok: false; readonly reason: "attestation_malformed" | "attestation_signature" | "attestation_audience" | "attestation_expired" | "attestation_key_mismatch" }

/** A presenter attestation (phase-1 design 2.2a) bound to `presenterKey`. */
export async function checkPresenterAttestation(claims: Record<string, unknown>, issuer: string, nowS: number, presenterKey: Uint8Array): Promise<AttestationCheck> {
  if (claims["aud"] !== PRESENTER.aud || claims["typ"] !== PRESENTER.typ) return { ok: false, reason: "attestation_audience" }
  const { iss, iat, exp, jti, acc, dev, dname } = claims
  const jkt = confirmationKey(claims)
  if (!nonEmpty(iss) || !whole(iat) || !whole(exp) || exp <= iat || !nonEmpty(jti) || !nonEmpty(acc) || !displayText(dev) || !displayText(dname) || !digest32(jkt))
    return { ok: false, reason: "attestation_malformed" }
  if (iss !== issuer) return { ok: false, reason: "attestation_signature" }
  if (lifetime(iat, exp, nowS, PRESENTER.maxLifeS) !== "ok") return { ok: false, reason: "attestation_expired" }
  if (jkt !== (await okpThumbprint(presenterKey))) return { ok: false, reason: "attestation_key_mismatch" }
  return { ok: true, acc, dev, dname, exp, jti }
}
