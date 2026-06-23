import { performance } from "node:perf_hooks"

export type DispatchInput = {
  url: string
  method: string
  headers?: Record<string, string>
  body?: string | Uint8Array
  timeout_ms: number
  forward_as_is: boolean
}

export type DispatchOutcome = {
  ok: boolean
  status: number | null
  response_headers: Record<string, string> | null
  response_body: string | null
  timing_total_ms: number
  error_message?: string
}

const RESPONSE_BODY_CAP_BYTES = 5_000_000

export async function dispatchProbe(input: DispatchInput): Promise<DispatchOutcome> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), input.timeout_ms)
  const startedAt = performance.now()
  try {
    const init: RequestInit = {
      method: input.method,
      headers: input.headers,
      signal: controller.signal,
    }
    if (input.body !== undefined && methodAllowsBody(input.method)) {
      init.body = toBodyInit(input.body)
    }
    if (input.forward_as_is) {
      init.redirect = "manual"
    }
    const res = await fetch(input.url, init)
    const responseHeaders = collectHeaders(res.headers)
    const body = await readBoundedText(res, RESPONSE_BODY_CAP_BYTES)
    const elapsed = Math.round(performance.now() - startedAt)
    return {
      ok: res.ok,
      status: res.status,
      response_headers: responseHeaders,
      response_body: body,
      timing_total_ms: elapsed,
    }
  } catch (err) {
    const elapsed = Math.round(performance.now() - startedAt)
    const message = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      status: null,
      response_headers: null,
      response_body: null,
      timing_total_ms: elapsed,
      error_message: message,
    }
  } finally {
    clearTimeout(timer)
  }
}

function methodAllowsBody(method: string): boolean {
  const upper = method.toUpperCase()
  return upper !== "GET" && upper !== "HEAD" && upper !== "OPTIONS"
}

function collectHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {}
  headers.forEach((value, key) => {
    out[key] = value
  })
  return out
}

async function readBoundedText(res: Response, cap: number): Promise<string> {
  const reader = res.body?.getReader()
  if (!reader) return ""
  const decoder = new TextDecoder("utf-8", { fatal: false })
  let total = 0
  let truncated = false
  let result = ""
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    if (!value) continue
    if (total + value.byteLength > cap) {
      const remaining = cap - total
      if (remaining > 0) {
        result += decoder.decode(value.subarray(0, remaining), { stream: true })
        total += remaining
      }
      truncated = true
      try { await reader.cancel() } catch { void 0 }
      break
    }
    result += decoder.decode(value, { stream: true })
    total += value.byteLength
  }
  result += decoder.decode()
  if (truncated) {
    result += `\n[probe-dispatcher: response body truncated at ${cap} bytes]`
  }
  return result
}

function toBodyInit(body: string | Uint8Array): BodyInit {
  if (typeof body === "string") return body
  const ab = new ArrayBuffer(body.byteLength)
  new Uint8Array(ab).set(body)
  return new Blob([ab])
}
