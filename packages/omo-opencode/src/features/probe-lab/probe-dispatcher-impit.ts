import { performance } from "node:perf_hooks"
import { getImpit } from "../../mcp/idm-browser/network/impit-loader"
import type { DispatchInput, DispatchOutcome } from "./probe-dispatcher"

export type ImpitBrowserProfile = "chrome" | "firefox"

export type ImpitDispatchInput = DispatchInput & {
  browser?: ImpitBrowserProfile
  proxy?: string
  ignore_tls_errors?: boolean
}

const RESPONSE_BODY_CAP_BYTES = 5_000_000

type ImpitInstance = {
  fetch: (url: string, init?: RequestInit) => Promise<Response>
}

type ImpitModule = {
  Impit: new (opts: {
    browser?: string
    proxyUrl?: string
    ignoreTlsErrors?: boolean
    timeout?: number
    vanillaFallback?: boolean
  }) => ImpitInstance
}

export async function dispatchProbeImpit(input: ImpitDispatchInput): Promise<DispatchOutcome> {
  const startedAt = performance.now()

  try {
    const impit = (await getImpit()) as ImpitModule

    const client = new impit.Impit({
      browser: input.browser ?? "firefox",
      proxyUrl: input.proxy,
      ignoreTlsErrors: input.ignore_tls_errors ?? false,
      timeout: input.timeout_ms,
      vanillaFallback: true,
    })

    const init: RequestInit = {
      method: input.method,
      headers: input.headers,
    }
    if (input.body !== undefined && methodAllowsBody(input.method)) {
      init.body = toBodyInit(input.body)
    }
    if (input.forward_as_is) {
      init.redirect = "manual"
    }

    const res = await client.fetch(input.url, init)
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
      error_message: `impit transport: ${message}`,
    }
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
  const text = await res.text()
  if (text.length <= cap) return text
  return `${text.slice(0, cap)}\n[probe-dispatcher-impit: response body truncated at ${cap} bytes]`
}

function toBodyInit(body: string | Uint8Array): BodyInit {
  if (typeof body === "string") return body
  const ab = new ArrayBuffer(body.byteLength)
  new Uint8Array(ab).set(body)
  return new Blob([ab])
}
