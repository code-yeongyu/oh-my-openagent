import { generateKeyPairSync, type KeyObject } from "node:crypto"

export const b64url = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64url")
const json = (value: unknown): string => b64url(new TextEncoder().encode(JSON.stringify(value)))

export interface TestIssuer {
  readonly key: { kty: string; crv: string; x: string; y: string; kid: string }
  sign(claims: Record<string, unknown>): Promise<string>
}

/** An ES256 issuer over a real P-256 key: its tokens verify only against its own published key. */
export async function testIssuer(kid = "k1"): Promise<TestIssuer> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey)
  const key = { kty: "EC", crv: "P-256", x: String(jwk.x), y: String(jwk.y), kid }
  return {
    key,
    async sign(claims) {
      const head = `${json({ alg: "ES256", kid, typ: "JWT" })}.${json(claims)}`
      const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, new TextEncoder().encode(head))
      return `${head}.${b64url(new Uint8Array(signature))}`
    },
  }
}

/** A real Ed25519 key pair; `spki` is the 44-byte SPKI DER the engine hands across the seam. */
export function ed25519Key(): { readonly spki: Uint8Array; readonly privateKey: KeyObject } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519")
  return { spki: new Uint8Array(publicKey.export({ format: "der", type: "spki" })), privateKey }
}
