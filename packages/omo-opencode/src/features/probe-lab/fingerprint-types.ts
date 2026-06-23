export type FingerprintEngine = "curl_cffi" | "camoufox" | "nodriver" | "bun_fetch" | "go_utls" | "custom"
export type FingerprintStatus = "active" | "deprecated" | "experimental"
export type HttpVersion = "HTTP/1.1" | "HTTP/2" | "HTTP/3"

export type FingerprintProfile = {
  id: string
  name: string
  engine: string
  tls_fingerprint: string | null
  http_version: string
  user_agent: string | null
  sec_ch_ua: string | null
  sec_ch_ua_platform: string | null
  accept_language: string
  header_order: string | null
  extra_headers: string | null
  proxy_required: number
  browser_profile: string | null
  status: FingerprintStatus
  last_verified_at: number | null
  detection_score: number | null
  created_at: number
}

export type NewFingerprintProfileInput = {
  id: string
  name: string
  engine: FingerprintEngine
  user_agent: string
  tls_fingerprint?: string | null
  http_version?: HttpVersion
  sec_ch_ua?: string | null
  sec_ch_ua_platform?: string | null
  accept_language?: string
  header_order?: ReadonlyArray<string> | null
  extra_headers?: Record<string, string> | null
  proxy_required?: boolean
  browser_profile?: string | null
}
