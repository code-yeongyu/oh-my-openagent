import type { ProbeProvider, ProbeRequest } from "../providers/provider-types"

const POLL_PATH = "/api/v0/file/fetch_files"
const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_INTERVAL_MS = 1_000
const POLL_REQUEST_TIMEOUT_MS = 15_000

export type PollFileInput = {
  provider: ProbeProvider
  baseUrl: string
  fileId: string
  requestId: string
  pollTimeoutMs?: number
  pollIntervalMs?: number
  sleep?: (ms: number) => Promise<void>
}

export type PollFileOutcome =
  | { ok: true; status: "SUCCESS" }
  | { ok: false; reason: string }

type FetchFilesEntry = { id?: unknown; status?: unknown }
type FetchFilesEnvelope = { data?: { biz_data?: { files?: ReadonlyArray<FetchFilesEntry> } } }

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export async function pollDeepSeekFileUntilReady(input: PollFileInput): Promise<PollFileOutcome> {
  const sleep = input.sleep ?? defaultSleep
  const timeoutMs = input.pollTimeoutMs ?? DEFAULT_TIMEOUT_MS
  const intervalMs = input.pollIntervalMs ?? DEFAULT_INTERVAL_MS
  const url = `${input.baseUrl.replace(/\/$/, "")}${POLL_PATH}?file_ids=${encodeURIComponent(input.fileId)}`
  const deadline = Date.now() + timeoutMs
  let attempt = 0
  while (Date.now() < deadline) {
    attempt += 1
    const req: ProbeRequest = {
      url,
      method: "GET",
      headers: {},
      timeout_ms: POLL_REQUEST_TIMEOUT_MS,
      forward_as_is: false,
      metadata: { session_id: `oai-upload-poll-${input.requestId}`, exchange_sequence: attempt },
    }
    const res = await input.provider.dispatchProbe(req)
    if (res.status !== 200) {
      return { ok: false, reason: `fetch_files HTTP ${res.status} on attempt ${attempt}` }
    }
    const status = readEntryStatus(res.body, input.fileId)
    if (status === "SUCCESS") return { ok: true, status: "SUCCESS" }
    if (status === "FAILED") return { ok: false, reason: `fetch_files reported FAILED for ${input.fileId}` }
    // CONTENT_EMPTY is terminal (not transient). DeepSeek's OCR pipeline classifies
    // images with no extractable content (e.g. tiny solid-color PNGs ~250 bytes) as
    // CONTENT_EMPTY in <5s. Valid photographic/text images reach SUCCESS in 1-3s.
    // Retrying would not change the outcome — the image inherently has no content.
    // See commit 6192678b for reproduction evidence.
    if (status === "CONTENT_EMPTY") return { ok: false, reason: `fetch_files reported CONTENT_EMPTY for ${input.fileId} (image has no extractable content)` }
    if (Date.now() + intervalMs >= deadline) break
    await sleep(intervalMs)
  }
  return { ok: false, reason: `fetch_files polling timed out after ${timeoutMs}ms for ${input.fileId}` }
}

function readEntryStatus(body: string, fileId: string): string | null {
  try {
    const env = JSON.parse(body) as FetchFilesEnvelope
    const list = env?.data?.biz_data?.files
    if (!Array.isArray(list)) return null
    for (const entry of list) {
      if (entry && typeof entry === "object" && entry.id === fileId && typeof entry.status === "string") {
        return entry.status
      }
    }
    return null
  } catch {
    return null
  }
}
