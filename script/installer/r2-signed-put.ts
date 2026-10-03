// AWS Signature V4 PUT for R2. Bun.S3Client cannot attach x-amz-checksum-sha256, and R2 rejects unsigned
// x-amz-* headers on presigned URLs, so uploads sign the real payload hash: R2 recomputes it on receipt and
// refuses a body whose bytes differ (XAmzContentSHA256Mismatch), and stores the checksum for later HEADs.
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
  ) {
    super(message)
    this.name = "R2UploadError"
  }
}

const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data).digest()
const encodeKey = (key: string) => key.split("/").map((part) => encodeURIComponent(part)).join("/")

export function signPut(
  credentials: R2Credentials,
  key: string,
  sha256Hex: string,
  extraHeaders: Readonly<Record<string, string>>,
  now: Date = new Date(),
): { readonly url: string; readonly headers: Record<string, string> } {
  const host = `${credentials.accountId}.r2.cloudflarestorage.com`
  const path = `/${credentials.bucket}/${encodeKey(key)}`
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "")
  const day = amzDate.slice(0, 8)
  const headers: Record<string, string> = {
    host,
    "x-amz-checksum-sha256": Buffer.from(sha256Hex, "hex").toString("base64"),
    "x-amz-content-sha256": sha256Hex,
    "x-amz-date": amzDate,
    ...Object.fromEntries(Object.entries(extraHeaders).map(([name, value]) => [name.toLowerCase(), value.trim()])),
  }
  const names = Object.keys(headers).sort()
  const canonical = ["PUT", path, "", ...names.map((name) => `${name}:${headers[name]}`), "", names.join(";"), sha256Hex].join("\n")
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
  if (!response.ok) throw new R2UploadError(`PUT ${key} -> ${response.status} ${(await response.text()).slice(0, 300)}`, response.status)
}
