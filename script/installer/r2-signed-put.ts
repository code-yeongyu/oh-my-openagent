// AWS Signature V4 requests for R2. Bun.S3Client cannot attach x-amz-checksum-sha256, and R2 rejects unsigned
// x-amz-* headers on presigned URLs, so uploads sign the real payload hash: R2 recomputes it on receipt and
// refuses a body whose bytes differ (XAmzContentSHA256Mismatch), and stores the checksum for later HEADs.
// Bodyless HEAD/GET/DELETE requests sign the empty payload hash and expose the raw response for diagnostics.
import { createHash, createHmac } from "node:crypto"

export interface R2Credentials {
  readonly accountId: string
  readonly accessKeyId: string
  readonly secretAccessKey: string
  readonly bucket: string
}

export class R2UploadError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string = "UnknownError",
    readonly requestId: string | null = null,
  ) {
    super(message)
    this.name = "R2UploadError"
  }
}

type BodylessMethod = "HEAD" | "GET" | "DELETE"

const EMPTY_SHA256 = createHash("sha256").digest("hex")
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data).digest()
const encodeKey = (key: string) => key.split("/").map((part) => encodeURIComponent(part)).join("/")

/** Replaces the secret before the access key, so an access key inside the secret cannot leave a fragment of it. */
export function credentialRedactor(credentials: R2Credentials): (value: string) => string {
  return (value) => value.replaceAll(credentials.secretAccessKey, "<redacted>").replaceAll(credentials.accessKeyId, "<redacted>")
}

function signRequest(
  credentials: R2Credentials,
  method: "PUT" | BodylessMethod,
  key: string,
  sha256Hex: string,
  extraHeaders: Readonly<Record<string, string>>,
  now: Date,
): { readonly url: string; readonly headers: Record<string, string> } {
  const host = `${credentials.accountId}.r2.cloudflarestorage.com`
  const path = `/${credentials.bucket}/${encodeKey(key)}`
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "")
  const day = amzDate.slice(0, 8)
  const headers: Record<string, string> = {
    host,
    "x-amz-content-sha256": sha256Hex,
    "x-amz-date": amzDate,
    ...Object.fromEntries(Object.entries(extraHeaders).map(([name, value]) => [name.toLowerCase(), value.trim()])),
  }
  const names = Object.keys(headers).sort()
  const canonical = [method, path, "", ...names.map((name) => `${name}:${headers[name]}`), "", names.join(";"), sha256Hex].join("\n")
  const scope = `${day}/auto/s3/aws4_request`
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, createHash("sha256").update(canonical).digest("hex")].join("\n")
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${credentials.secretAccessKey}`, day), "auto"), "s3"), "aws4_request")
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex")
  const { host: _host, ...sent } = headers
  sent.authorization = `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`
  return { url: `https://${host}${path}`, headers: sent }
}

export function signPut(
  credentials: R2Credentials,
  key: string,
  sha256Hex: string,
  extraHeaders: Readonly<Record<string, string>>,
  now: Date = new Date(),
): { readonly url: string; readonly headers: Record<string, string> } {
  const checksum = { "x-amz-checksum-sha256": Buffer.from(sha256Hex, "hex").toString("base64") }
  return signRequest(credentials, "PUT", key, sha256Hex, { ...checksum, ...extraHeaders }, now)
}

/** One signed bodyless request; the caller reads the status, headers and body itself. */
export function signedRequest(credentials: R2Credentials, method: BodylessMethod, key: string): Promise<Response> {
  const { url, headers } = signRequest(credentials, method, key, EMPTY_SHA256, {}, new Date())
  return fetch(url, { method, headers })
}

async function toUploadError(credentials: R2Credentials, method: string, key: string, response: Response): Promise<R2UploadError> {
  const body = await response.text()
  const redact = credentialRedactor(credentials)
  const code = redact(/<Code>([^<]*)<\/Code>/.exec(body)?.[1] ?? "UnknownError")
  const id = response.headers.get("x-amz-request-id") || /<RequestId>([^<]*)<\/RequestId>/.exec(body)?.[1] || response.headers.get("cf-ray") || null
  const requestId = id === null ? null : redact(id)
  const message = redact(`${method} ${key} -> HTTP ${response.status} ${code}: ${/<Message>([^<]*)<\/Message>/.exec(body)?.[1] ?? response.statusText}; requestId=${requestId ?? "(not provided)"}`)
  return new R2UploadError(message, response.status, code, requestId)
}

export async function deleteObject(credentials: R2Credentials, key: string): Promise<void> {
  const response = await signedRequest(credentials, "DELETE", key)
  if (!response.ok) throw await toUploadError(credentials, "DELETE", key, response)
}

export async function putVerified(
  credentials: R2Credentials,
  key: string,
  file: Blob,
  sha256Hex: string,
  metadata: Readonly<Record<string, string>>,
): Promise<void> {
  const { url, headers } = signPut(credentials, key, sha256Hex, metadata)
  const response = await fetch(url, { method: "PUT", body: file, headers: { ...headers, "content-length": String(file.size) } })
  if (!response.ok) throw await toUploadError(credentials, "PUT", key, response)
}
