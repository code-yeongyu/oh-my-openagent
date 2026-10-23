import { gzipSync } from "node:zlib"

import { fromBinary } from "@bufbuild/protobuf"

import { ExportLogsServiceResponseSchema } from "./otlp-proto/opentelemetry/proto/collector/logs/v1/logs_service_pb.js"
import { ExportTraceServiceResponseSchema } from "./otlp-proto/opentelemetry/proto/collector/trace/v1/trace_service_pb.js"
import type { Signal } from "./otlp-spool-file"

export const MAX_BODY_BYTES = 256 * 1024
export const GZIP_THRESHOLD_BYTES = 8 * 1024
export const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000] as const
export const MAX_RETRY_AFTER_MS = 60_000
export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000

/**
 * The longest one batch's send can take: every attempt ends by its request timeout and every pause
 * between attempts is at most MAX_RETRY_AFTER_MS (the jittered backoff stays below it). The claim's
 * lease is not renewed past this point, so a send stuck anywhere else frees its batch for others.
 */
export function maxSendMs(requestTimeoutMs: number): number {
  return (BACKOFF_MS.length + 1) * requestTimeoutMs + BACKOFF_MS.length * MAX_RETRY_AFTER_MS
}

const RETRYABLE = new Set([429, 502, 503, 504])
const NON_RETRYABLE = new Set([400, 401, 413])

export type OtlpFetch = (url: string, init: RequestInit) => Promise<Response>

export type PostDeps = {
  readonly fetch: OtlpFetch
  readonly sleep: (ms: number, abort: AbortSignal) => Promise<void>
  readonly random: () => number
  readonly endpoint: string
  readonly ingestKey: string
  readonly abort: AbortSignal
  readonly requestTimeoutMs: number
}

export type PartialSuccess = { readonly rejected: number; readonly message: string }

export type PostOutcome =
  | { readonly kind: "accepted"; readonly partial: PartialSuccess | undefined }
  | { readonly kind: "rejected"; readonly status: number }
  | { readonly kind: "retry_later" }
  | { readonly kind: "aborted" }

type Attempt =
  | { readonly kind: "done"; readonly outcome: PostOutcome }
  | { readonly kind: "retry"; readonly retryAfterMs: number | undefined }

export function parseRetryAfter(value: string | null, nowMs: number): number | undefined {
  if (value === null || value.trim() === "") return undefined
  const seconds = Number(value)
  const ms = Number.isFinite(seconds) ? seconds * 1_000 : Date.parse(value) - nowMs
  return Number.isFinite(ms) ? Math.min(Math.max(ms, 0), MAX_RETRY_AFTER_MS) : undefined
}

async function partialSuccess(signal: Signal, response: Response): Promise<PartialSuccess | undefined> {
  try {
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength === 0) return undefined
    if (signal === "logs") {
      const partial = fromBinary(ExportLogsServiceResponseSchema, bytes).partialSuccess
      return partial === undefined ? undefined : { rejected: Number(partial.rejectedLogRecords), message: partial.errorMessage }
    }
    const partial = fromBinary(ExportTraceServiceResponseSchema, bytes).partialSuccess
    return partial === undefined ? undefined : { rejected: Number(partial.rejectedSpans), message: partial.errorMessage }
  } catch {
    return undefined
  }
}

async function exchange(deps: PostDeps, signal: Signal, body: Uint8Array, abort: AbortSignal): Promise<Attempt> {
  const compressed = body.byteLength > GZIP_THRESHOLD_BYTES
  const headers: Record<string, string> = {
    "content-type": "application/x-protobuf",
    "x-omo-ingest-key": deps.ingestKey,
    ...(compressed ? { "content-encoding": "gzip" } : {}),
  }
  const response = await deps.fetch(`${deps.endpoint}/v1/${signal}`, {
    method: "POST",
    headers,
    body: compressed ? gzipSync(body) : body,
    signal: abort,
  })
  if (response.status >= 200 && response.status < 300) {
    return { kind: "done", outcome: { kind: "accepted", partial: await partialSuccess(signal, response) } }
  }
  if (NON_RETRYABLE.has(response.status)) return { kind: "done", outcome: { kind: "rejected", status: response.status } }
  if (RETRYABLE.has(response.status)) {
    return { kind: "retry", retryAfterMs: parseRetryAfter(response.headers.get("retry-after"), Date.now()) }
  }
  return { kind: "done", outcome: { kind: "retry_later" } }
}

/**
 * One request, response body included, bounded by the request timeout: the timeout aborts the fetch
 * and also settles the attempt itself, so a fetch that ignores its signal cannot hold the sender.
 * The timer is unref'd, so a pending attempt never keeps the host process alive.
 */
async function attempt(deps: PostDeps, signal: Signal, body: Uint8Array): Promise<Attempt> {
  const timeout = new AbortController()
  const timer = setTimeout(() => timeout.abort(), deps.requestTimeoutMs)
  timer.unref?.()
  const timedOut = new Promise<never>((_, reject) => {
    timeout.signal.addEventListener("abort", () => reject(new Error("OTLP request timed out")), { once: true })
  })
  try {
    return await Promise.race([exchange(deps, signal, body, AbortSignal.any([deps.abort, timeout.signal])), timedOut])
  } catch {
    return deps.abort.aborted ? { kind: "done", outcome: { kind: "aborted" } } : { kind: "retry", retryAfterMs: undefined }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * One file = one request. 429/502/503/504, network errors and timed-out requests are retried after 1, 2, 4, 8 and
 * 16 s plus up to 20% jitter (Retry-After wins, capped at 60 s); 400/401/413 are never retried; a
 * 2xx, including one carrying partial_success, settles the batch.
 */
export async function postWithRetry(deps: PostDeps, signal: Signal, body: Uint8Array): Promise<PostOutcome> {
  if (body.byteLength > MAX_BODY_BYTES) return { kind: "rejected", status: 413 }
  for (let index = 0; ; index += 1) {
    if (deps.abort.aborted) return { kind: "aborted" }
    const result = await attempt(deps, signal, body)
    if (result.kind === "done") return result.outcome
    const backoff = BACKOFF_MS[index]
    if (backoff === undefined) return { kind: "retry_later" }
    await deps.sleep(result.retryAfterMs ?? backoff + Math.floor(deps.random() * backoff * 0.2), deps.abort)
  }
}
