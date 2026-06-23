import { STEALTH_USER_PREFS } from "./camoufox-stealth-prefs"

export const DEFAULT_DOH_ENDPOINT = "https://mozilla.cloudflare-dns.com/dns-query"

export type UserPrefModifiers = {
  dnsOverHttps?: boolean
  dohEndpoint?: string
}

export function mergeUserPrefs(
  overrides: Record<string, unknown> | undefined,
  modifiers: UserPrefModifiers = {},
): Record<string, unknown> {
  const base: Record<string, unknown> = { ...STEALTH_USER_PREFS }
  if (modifiers.dnsOverHttps) {
    base["network.trr.mode"] = 3
    base["network.trr.uri"] = modifiers.dohEndpoint ?? DEFAULT_DOH_ENDPOINT
    base["network.trr.bootstrapAddress"] = "1.1.1.1"
  }
  if (overrides) Object.assign(base, overrides)
  return base
}
