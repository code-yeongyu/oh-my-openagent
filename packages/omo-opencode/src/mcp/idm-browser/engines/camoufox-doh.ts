export const DEFAULT_DOH_ENDPOINT = "https://mozilla.cloudflare-dns.com/dns-query"

export type DohOptions = {
  enabled?: boolean
  endpoint?: string
}

export function buildDohPrefs(opts: DohOptions): Record<string, unknown> {
  if (!opts.enabled) return {}
  return {
    "network.trr.mode": 3,
    "network.trr.uri": opts.endpoint ?? DEFAULT_DOH_ENDPOINT,
    "network.trr.bootstrapAddress": "1.1.1.1",
  }
}
