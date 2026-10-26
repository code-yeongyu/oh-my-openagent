// AWS Signature V4 PUT and DELETE for R2: every mutating request the mirror sends goes through here, so each failure
// carries the same diagnostics (status, R2 code, request id, cf-ray, body excerpt; credentials redacted).
// Bun.S3Client cannot attach x-amz-checksum-sha256, and R2 rejects unsigned x-amz-* headers on presigned URLs, so
// uploads sign the real payload hash: R2 recomputes it on receipt and refuses a body whose bytes differ
// (XAmzContentSHA256Mismatch), and stores the checksum for later HEADs.
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
    readonly cfRay: string | null = null,
  ) {
    super(message)
    this.name = "R2UploadError"
  }
}

const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data).digest()
const encodeKey = (key: string) => key.split("/").map((part) => encodeURIComponent(part)).join("/")
const EMPTY_PAYLOAD_SHA256 = createHash("sha256").update("").digest("hex")
const BODY_EXCERPT_CHARS = 200

type SignedRequest = { readonly url: string; readonly headers: Record<string, string> }

export function signPut(
  credentials: R2Credentials,
  key: string,
  sha256Hex: string,
  extraHeaders: Readonly<Record<string, string>>,
  now: Date = new Date(),
): SignedRequest {
  const checksum = { "x-amz-checksum-sha256": Buffer.from(sha256Hex, "hex").toString("base64") }
  return signRequest("PUT", credentials, key, sha256Hex, { ...checksum, ...extraHeaders }, now)
}

function signRequest(
  method: "PUT" | "DELETE",
  credentials: R2Credentials,
  key: string,
  sha256Hex: string,
  extraHeaders: Readonly<Record<string, string>>,
  now: Date,
): SignedRequest {
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

export async function putVerified(
  credentials: R2Credentials,
  key: string,
  file: Blob,
  sha256Hex: string,
  metadata: Readonly<Record<string, string>>,
): Promise<void> {
  const { url, headers } = signPut(credentials, key, sha256Hex, metadata)
  const response = await fetch(url, { method: "PUT", body: file, headers: { ...headers, "content-length": String(file.size) } })
  if (!response.ok) throw await requestError(credentials, "PUT", key, response)
}

/** S3 DELETE is idempotent (deleting an absent key also succeeds), so callers may retry it. */
export async function deleteVerified(credentials: R2Credentials, key: string): Promise<void> {
  const { url, headers } = signRequest("DELETE", credentials, key, EMPTY_PAYLOAD_SHA256, {}, new Date())
  const response = await fetch(url, { method: "DELETE", headers })
  if (!response.ok) throw await requestError(credentials, "DELETE", key, response)
}

async function requestError(credentials: R2Credentials, method: string, key: string, response: Response): Promise<R2UploadError> {
  const body = await response.text()
  const redact = (value: string) => value.replaceAll(credentials.secretAccessKey, "<redacted>").replaceAll(credentials.accessKeyId, "<redacted>")
  const code = redact(/<Code>([^<]*)<\/Code>/.exec(body)?.[1] ?? "UnknownError")
  const id = response.headers.get("x-amz-request-id") || /<RequestId>([^<]*)<\/RequestId>/.exec(body)?.[1] || response.headers.get("cf-ray") || null
  const requestId = id === null ? null : redact(id)
  const ray = response.headers.get("cf-ray") || null
  const cfRay = ray === null ? null : redact(ray)
  // A non-XML failure (an edge 5xx page) has no <Message>; keep a one-line excerpt of the redacted body instead.
  const detail = /<Message>([^<]*)<\/Message>/.exec(body)?.[1] ?? (redact(body).replace(/\s+/g, " ").trim().slice(0, BODY_EXCERPT_CHARS) || response.statusText)
  const message = redact(`${method} ${key} -> HTTP ${response.status} ${code}: ${detail}; requestId=${requestId ?? "(not provided)"}; cfRay=${cfRay ?? "(not provided)"}`)
  return new R2UploadError(message, response.status, code, requestId, cfRay)
}
