import {
  attachPowResponseHeader,
  defaultFetchPowChallenge,
  isPowProtectedTarget,
  type FetchPowChallengeFn,
} from "../providers/deepseek-web-pow-handler"
import type { ProviderCredentials } from "../providers/provider-types"
import {
  buildDeepSeekSpaHeaders,
  parseDeepSeekAuthConfig,
} from "./deepseek-spa-headers"
import { dispatchStreamingViaCurl } from "./streaming-via-curl"
import type { StreamingDispatchResult } from "./streaming-dispatch-types"

const COMPLETION_PATH = "/api/v0/chat/completion"
const COMPLETION_TIMEOUT_MS = 120_000

export type StreamingDispatchInput = {
  baseUrl: string
  creds: ProviderCredentials
  requestBody: string
  signal?: AbortSignal
  fetchChallenge?: FetchPowChallengeFn
  fetchImpl?: typeof fetch
  curlDispatchImpl?: typeof dispatchStreamingViaCurl
}

export type { StreamingDispatchResult } from "./streaming-dispatch-types"

function headersToRecord(h: Headers): Record<string, string> {
  const out: Record<string, string> = {}
  h.forEach((v, k) => {
    out[k] = v
  })
  return out
}

export async function dispatchStreamingCompletion(
  input: StreamingDispatchInput,
): Promise<StreamingDispatchResult> {
  const auth = parseDeepSeekAuthConfig(input.creds.auth_config)
  let { headers, proxyUrl } = buildDeepSeekSpaHeaders(input.creds, {
    "Content-Type": "application/json",
    Accept: "application/json",
  })
  const url = `${input.baseUrl.replace(/\/$/, "")}${COMPLETION_PATH}`
  if (auth.auto_solve_pow && isPowProtectedTarget(url)) {
    headers = await attachPowResponseHeader({
      base_url: input.baseUrl,
      request_url: url,
      request_headers: headers,
      fetchChallenge: input.fetchChallenge ?? defaultFetchPowChallenge(),
    })
  }
  const ac = new AbortController()
  let timeoutFired = false
  const timeoutId = setTimeout(() => {
    timeoutFired = true
    ac.abort()
  }, COMPLETION_TIMEOUT_MS)
  if (input.signal) {
    if (input.signal.aborted) ac.abort()
    else input.signal.addEventListener("abort", () => ac.abort(), { once: true })
  }
  if (proxyUrl) {
    const result = await (input.curlDispatchImpl ?? dispatchStreamingViaCurl)({
      url,
      method: "POST",
      headers,
      body: input.requestBody,
      proxyUrl,
      signal: ac.signal,
    })
    clearTimeout(timeoutId)
    return result
  }
  const fetchImpl = input.fetchImpl ?? fetch
  let res: Response
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers,
      body: input.requestBody,
      signal: ac.signal,
    })
  } catch (err) {
    clearTimeout(timeoutId)
    const msg = err instanceof Error ? err.message : String(err)
    if (timeoutFired) {
      return {
        ok: false,
        status: 0,
        bodyText: "",
        reason: `streaming dispatch timeout after ${COMPLETION_TIMEOUT_MS}ms: ${msg}`,
      }
    }
    return {
      ok: false,
      status: 0,
      bodyText: "",
      reason: `streaming dispatch error: ${msg}`,
    }
  }
  clearTimeout(timeoutId)
  if (res.status !== 200 || !res.body) {
    const bodyText = await res.text().catch(() => "")
    return {
      ok: false,
      status: res.status,
      bodyText,
      reason: `upstream HTTP ${res.status}`,
    }
  }
  return {
    ok: true,
    status: res.status,
    headers: headersToRecord(res.headers),
    body: res.body,
  }
}
