import type { BrowserAutomationConfig } from "../../../config/schema/browser-automation"
import { resolveCredential } from "../state/credentials"
import { buildProxyUrl } from "../network/proxy"
import type { CamoufoxLaunchOptions } from "../engines"

export async function buildEngineProxy(
  config: BrowserAutomationConfig,
): Promise<CamoufoxLaunchOptions["proxy"] | undefined> {
  if (!config.proxy) return undefined

  const credentialsRef = config.proxy.credentials
  const cred = await resolveCredential("env", credentialsRef)

  const proxySession = buildProxyUrl({
    provider: config.proxy.provider,
    protocol: config.proxy.protocol,
    endpoint: config.proxy.endpoint,
    username: cred.username,
    password: cred.password,
    country: config.proxy.session?.country,
    city: config.proxy.session?.city ?? undefined,
    sessionMode: config.proxy.session?.mode,
    sessionDurationMinutes: config.proxy.session?.duration_minutes,
  })

  return {
    server: proxySession.server,
    username: proxySession.username,
    password: proxySession.password,
    bypass: "stripe.com,*.stripe.com,js.stripe.com,assets.app.kiro.dev,kaa-assets.app.kiro.dev",
  }
}
