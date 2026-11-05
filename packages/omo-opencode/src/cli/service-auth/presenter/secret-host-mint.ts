import { checkSecretHostToken, rawEd25519Key, verifyIssuerSignature, type IssuerKey } from "./issuer-token"

export interface SecretHostTokenRequest {
  readonly hostInstance: string
  readonly durableSessionId: string
  readonly hostKeySpki: Uint8Array
  readonly sign: (proof: { readonly issuer: string; readonly nonce: string }) => string
}

const MINT_STEP_TIMEOUT_MS = 10_000
const NONCE = /^[A-Za-z0-9_-]{43}$/

// The mint's own refusals carry no request or response value, so neither the access token nor the issuer's body can
// reach an error message, a log line or a caller.
class SecretHostMintError extends Error {
  constructor(reason: string) {
    super(`secret host token unavailable: ${reason}`)
    this.name = "SecretHostMintError"
  }
}

export async function mintSecretHostToken(
  request: SecretHostTokenRequest,
  context: {
    readonly origin: string
    readonly issuer: string
    readonly account: string | undefined
    readonly accessToken: (account: string) => Promise<string>
    readonly fetch: (url: string, init: RequestInit) => Promise<Response>
    readonly keys: () => Promise<readonly IssuerKey[]>
    readonly nowS: () => number
  },
): Promise<string> {
  const { account } = context
  if (account === undefined) throw new SecretHostMintError("signed_out")
  const rawKey = rawEd25519Key(request.hostKeySpki)
  if (rawKey === undefined) throw new SecretHostMintError("host_key_malformed")
  const publicKey = Buffer.from(rawKey).toString("base64url")
  let bearer: string | undefined
  try {
    bearer = await context.accessToken(account)
  } catch {
    throw new SecretHostMintError("signed_out")
  }
  const post = async (path: string, body: object): Promise<Record<string, unknown>> => {
    let response: Response
    try {
      response = await context.fetch(`${context.origin}/v1/session/secret-host/${path}`, {
        method: "POST",
        redirect: "error",
        headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(MINT_STEP_TIMEOUT_MS),
      })
    } catch {
      throw new SecretHostMintError(`${path}_unreachable`)
    }
    if (!response.ok) throw new SecretHostMintError(`${path}_refused_${response.status}`)
    const value: unknown = await response.json().catch(() => undefined)
    if (typeof value !== "object" || value === null) throw new SecretHostMintError(`${path}_malformed`)
    return value as Record<string, unknown>
  }
  try {
    const { nonce } = await post("challenge", { publicKey })
    if (typeof nonce !== "string" || !NONCE.test(nonce)) throw new SecretHostMintError("challenge_malformed")
    const signature = request.sign({ issuer: context.issuer, nonce })
    const { hostToken } = await post("token", { publicKey, nonce, hin: request.hostInstance, sid: request.durableSessionId, signature })
    if (typeof hostToken !== "string") throw new SecretHostMintError("token_malformed")
    // The engine trusts what this returns, so the issuer's answer is held to the token it asked for.
    const signed = await verifyIssuerSignature(hostToken, await context.keys())
    const claims = signed.kind === "verified" ? await checkSecretHostToken(signed.claims, context.issuer, context.nowS(), rawKey) : undefined
    if (claims === undefined || claims.acc !== account || claims.hin !== request.hostInstance || claims.sid !== request.durableSessionId)
      throw new SecretHostMintError("token_unexpected")
    return hostToken
  } finally {
    bearer = undefined
  }
}
