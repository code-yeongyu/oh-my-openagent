import { solveDeepSeekHashV1 } from "../pow/deepseek-hash-v1/algorithm"
import { buildPowResponseHeader } from "../pow/deepseek-hash-v1/header-builder"
import type { DsHashV1Challenge } from "../pow/deepseek-hash-v1/types"
import { dispatchViaCurlCffi } from "../replay-engine-dispatcher"

const POW_CHALLENGE_PATH = "/api/v0/chat/create_pow_challenge"
const POW_PROTECTED_PATH_SUFFIXES: ReadonlyArray<string> = [
  "/api/v0/chat/completion",
  "/api/v0/file/upload_file",
]

export interface PowChallengeFetchResult {
  challenge: DsHashV1Challenge
  cookies: string
}

export type FetchPowChallengeFn = (input: {
  base_url: string
  target_path: string
  headers: Record<string, string>
}) => Promise<PowChallengeFetchResult>

export interface AttachPowOptions {
  base_url: string
  request_url: string
  request_headers: Record<string, string>
  fetchChallenge: FetchPowChallengeFn
}

export function isPowProtectedTarget(url: string): boolean {
  const path = (() => {
    try {
      return new URL(url).pathname
    } catch {
      return url
    }
  })()
  return POW_PROTECTED_PATH_SUFFIXES.some((suffix) => path.endsWith(suffix))
}

export async function attachPowResponseHeader(opts: AttachPowOptions): Promise<Record<string, string>> {
  const target_path = extractTargetPath(opts.request_url)
  const { challenge, cookies } = await opts.fetchChallenge({
    base_url: opts.base_url,
    target_path,
    headers: opts.request_headers,
  })
  const { answer } = solveDeepSeekHashV1(challenge)
  const header = buildPowResponseHeader({ challenge, answer, target_path })
  return mergeCookieHeader({ ...opts.request_headers, [header.name]: header.value }, cookies)
}

export function defaultFetchPowChallenge(): FetchPowChallengeFn {
  return async ({ base_url, target_path, headers }) => {
    const url = `${base_url.replace(/\/$/, "")}${POW_CHALLENGE_PATH}`
    try {
      const res = await dispatchViaCurlCffi({
        url,
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ target_path }),
      })
      if (res.status < 200 || res.status >= 300) {
        throw new Error(`pow challenge fetch failed: HTTP ${res.status}`)
      }
      const json = JSON.parse(res.body) as { data?: { biz_data?: { challenge?: DsHashV1Challenge } }; challenge?: DsHashV1Challenge }
      const challenge = json.data?.biz_data?.challenge ?? json.challenge
      if (!challenge) throw new Error("pow challenge response missing challenge object")
      return { challenge, cookies: extractCookiesFromResponse(res.headers) }
    } catch (e) {
      if (e instanceof Error && /requires a production driver registration/.test(e.message)) {
        return fallbackBunFetchChallenge({ url, target_path, headers })
      }
      throw e
    }
  }
}

async function fallbackBunFetchChallenge(opts: { url: string; target_path: string; headers: Record<string, string> }): Promise<PowChallengeFetchResult> {
  const res = await fetch(opts.url, {
    method: "POST",
    headers: { ...opts.headers, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ target_path: opts.target_path }),
  })
  if (!res.ok) {
    throw new Error(`pow challenge fetch failed: HTTP ${res.status} ${res.statusText}`)
  }
  const json = (await res.json()) as { data?: { biz_data?: { challenge?: DsHashV1Challenge } }; challenge?: DsHashV1Challenge }
  const challenge = json.data?.biz_data?.challenge ?? json.challenge
  if (!challenge) throw new Error("pow challenge response missing challenge object")
  return { challenge, cookies: serializeSetCookieValues(readSetCookieHeaders(res.headers)) }
}

function extractCookiesFromResponse(headers: Record<string, string>): string {
  const raw = headers["set-cookie"] ?? headers["Set-Cookie"] ?? ""
  if (!raw) return ""
  return raw.split(/,(?=\s*[A-Za-z0-9_-]+=)/).map((value) => value.split(";")[0]?.trim() ?? "").filter(Boolean).join("; ")
}

function extractTargetPath(url: string): string {
  try {
    return new URL(url).pathname
  } catch {
    return url
  }
}

function mergeCookieHeader(headers: Record<string, string>, cookies: string): Record<string, string> {
  const merged = [headers.Cookie, cookies].filter(Boolean).join("; ")
  return merged ? { ...headers, Cookie: merged } : headers
}

function readSetCookieHeaders(headers: Headers): string[] {
  const direct = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.()
  if (direct?.length) return direct
  const values: string[] = []
  headers.forEach((value, name) => { if (name.toLowerCase() === "set-cookie") values.push(value) })
  return values
}

function serializeSetCookieValues(values: string[]): string {
  return values.map((value) => value.split(";")[0]?.trim() ?? "").filter(Boolean).join("; ")
}
