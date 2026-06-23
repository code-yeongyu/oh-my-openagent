import type { BrowserContextOptions } from "playwright-core"
import type { FingerprintFamily } from "../fingerprint"

export function buildContextOptionsFromFamily(family: FingerprintFamily): BrowserContextOptions {
  const headers: Record<string, string> = {
    "accept-language": family.acceptLanguage,
  }
  if (family.secChUa) {
    headers["sec-ch-ua"] = family.secChUa
    headers["sec-ch-ua-mobile"] = family.secChUaMobile
    headers["sec-ch-ua-platform"] = family.secChUaPlatform
    if (family.secChUaFullVersionList) {
      headers["sec-ch-ua-full-version-list"] = family.secChUaFullVersionList
    }
  }

  return {
    userAgent: family.userAgent,
    viewport: { width: family.viewport.width, height: family.viewport.height },
    locale: family.locale,
    timezoneId: family.timezone,
    extraHTTPHeaders: headers,
  }
}
