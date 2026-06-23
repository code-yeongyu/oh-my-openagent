import { log } from "../../../shared/logger"
import type { ProbeProvider, ProbeRequest } from "../providers/provider-types"
import { pollDeepSeekFileUntilReady } from "./deepseek-file-poll"

const UPLOAD_PATH = "/api/v0/file/upload_file"
const UPLOAD_TIMEOUT_MS = 60_000

export type UploadDeepSeekImageInput = {
  provider: ProbeProvider
  baseUrl: string
  imageData: Uint8Array
  filename: string
  mimeType: string
  requestId: string
  visionModel?: boolean
  pollTimeoutMs?: number
  pollIntervalMs?: number
  exchangeSequence?: number
}

export type UploadDeepSeekImageOutcome =
  | { ok: true; fileId: string }
  | { ok: false; reason: string }

type UploadEnvelope = { data?: { biz_data?: { id?: unknown; status?: unknown } }; biz_code?: unknown }

export async function uploadDeepSeekImage(input: UploadDeepSeekImageInput): Promise<UploadDeepSeekImageOutcome> {
  const multipart = await encodeImageMultipart(input.imageData, input.filename, input.mimeType)
  const url = `${input.baseUrl.replace(/\/$/, "")}${UPLOAD_PATH}`
  const headers: Record<string, string> = {
    "Content-Type": multipart.contentType,
    "x-file-size": String(input.imageData.byteLength),
    "x-thinking-enabled": "1",
  }
  if (input.visionModel) headers["x-model-type"] = "vision"
  const req: ProbeRequest = {
    url,
    method: "POST",
    headers,
    body: multipart.bytes,
    timeout_ms: UPLOAD_TIMEOUT_MS,
    forward_as_is: false,
    metadata: {
      session_id: `oai-upload-${input.requestId}`,
      exchange_sequence: input.exchangeSequence ?? 1,
    },
  }
  const res = await input.provider.dispatchProbe(req)
  if (res.status !== 200) {
    return { ok: false, reason: `upload_file HTTP ${res.status}` }
  }
  const fileId = readUploadedFileId(res.body)
  if (!fileId) {
    return { ok: false, reason: "upload_file response missing data.biz_data.id" }
  }
  log(`openai-compat-upload: uploaded [rid=${input.requestId}] file_id=${fileId} bytes=${input.imageData.byteLength} mime=${input.mimeType}`)
  const ready = await pollDeepSeekFileUntilReady({
    provider: input.provider,
    baseUrl: input.baseUrl,
    fileId,
    requestId: input.requestId,
    pollTimeoutMs: input.pollTimeoutMs,
    pollIntervalMs: input.pollIntervalMs,
  })
  if (!ready.ok) {
    return { ok: false, reason: ready.reason }
  }
  return { ok: true, fileId }
}

async function encodeImageMultipart(bytes: Uint8Array, filename: string, mimeType: string): Promise<{ bytes: Uint8Array; contentType: string }> {
  const boundary = `----idm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  const safeFilename = filename.replace(/"/g, "")
  const head = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safeFilename}"\r\nContent-Type: ${mimeType}\r\n\r\n`
  const tail = `\r\n--${boundary}--\r\n`
  const headBytes = new TextEncoder().encode(head)
  const tailBytes = new TextEncoder().encode(tail)
  const out = new Uint8Array(headBytes.byteLength + bytes.byteLength + tailBytes.byteLength)
  out.set(headBytes, 0)
  out.set(bytes, headBytes.byteLength)
  out.set(tailBytes, headBytes.byteLength + bytes.byteLength)
  return { bytes: out, contentType: `multipart/form-data; boundary=${boundary}` }
}

function readUploadedFileId(body: string): string | null {
  try {
    const env = JSON.parse(body) as UploadEnvelope
    const biz = env?.data?.biz_data
    if (!biz || typeof biz !== "object") return null
    if (typeof biz.id !== "string" || biz.id.length === 0) return null
    return biz.id
  } catch {
    return null
  }
}
