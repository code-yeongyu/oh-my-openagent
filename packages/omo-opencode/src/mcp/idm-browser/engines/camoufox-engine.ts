import { join } from "node:path"
import { homedir } from "node:os"
import type { Browser, BrowserContext, Page } from "playwright-core"
import type { LaunchOptions as CamoufoxNativeOptions } from "camoufox-js"
import { appendServerLog } from "../server/console-silencer"
import { mergeUserPrefs } from "./camoufox-user-prefs"
import { resolveProxyEgressIp } from "./camoufox-geoip-resolver"
import { attachViewportCoherence } from "./camoufox-viewport-coherence"

const CAMOUFOX_LOG_PATH = join(homedir(), "Library", "Caches", "idm", "browser", "server.log")
const DEFAULT_LOCALE: string[] = ["it-IT", "en-US"]
const DEFAULT_OS: NonNullable<CamoufoxNativeOptions["os"]> = ["windows", "macos"]

export type CamoufoxLaunchOptions = Pick<
  CamoufoxNativeOptions,
  | "headless"
  | "proxy"
  | "humanize"
  | "geoip"
  | "locale"
  | "os"
  | "block_images"
  | "block_webrtc"
  | "firefox_user_prefs"
  | "fonts"
  | "custom_fonts_only"
  | "window"
  | "screen"
> & {
  dns_over_https?: boolean
  doh_endpoint?: string
}

export type WindowSize = NonNullable<CamoufoxLaunchOptions["window"]>

export type EngineProxy = NonNullable<CamoufoxLaunchOptions["proxy"]>

export type EngineInstance = {
  browser: Browser
  defaultContext: BrowserContext
  newPage: () => Promise<Page>
  close: () => Promise<void>
  proxy?: EngineProxy
}

export async function launchCamoufox(options: CamoufoxLaunchOptions = {}): Promise<EngineInstance> {
  const camoufoxModuleName = "camoufox-js"
  const { Camoufox } = (await import(camoufoxModuleName)) as typeof import("camoufox-js")

  const headlessDefault = process.env.BROWSER_HEADLESS === "false" ? false : true
  const headless = options.headless ?? headlessDefault
  const proxyOpt = options.proxy
  const geoipResolved = await resolveGeoIp(options.geoip, proxyOpt)
  const locale = options.locale ?? DEFAULT_LOCALE
  const userPrefs = mergeUserPrefs(options.firefox_user_prefs, {
    dnsOverHttps: options.dns_over_https,
    dohEndpoint: options.doh_endpoint,
  })

  appendServerLog(CAMOUFOX_LOG_PATH, "diag", {
    stage: "launchCamoufox:entry",
    headless,
    hasProxy: !!proxyOpt,
    proxyServer: typeof proxyOpt === "object" && proxyOpt !== null ? proxyOpt.server : undefined,
    proxyHasUsername: typeof proxyOpt === "object" && proxyOpt !== null ? !!proxyOpt.username : false,
    locale,
    geoipMode: typeof geoipResolved === "string" ? "explicit-ip" : geoipResolved ? "auto" : "off",
    humanize: options.humanize,
  })

  const result = await Camoufox({
    headless,
    humanize: options.humanize ?? true,
    geoip: geoipResolved,
    locale,
    os: options.os ?? DEFAULT_OS,
    block_images: options.block_images ?? false,
    block_webrtc: options.block_webrtc ?? true,
    firefox_user_prefs: userPrefs,
    proxy: options.proxy,
    ...(options.window ? { window: options.window } : {}),
    ...(options.screen ? { screen: options.screen } : {}),
    ...(options.fonts ? { fonts: options.fonts } : {}),
    ...(options.custom_fonts_only !== undefined ? { custom_fonts_only: options.custom_fonts_only } : {}),
  })

  return adaptResult(result, options.window, normalizeEngineProxy(options.proxy))
}

function normalizeEngineProxy(proxy: CamoufoxLaunchOptions["proxy"]): EngineProxy | undefined {
  if (!proxy) return undefined
  return proxy
}

async function resolveGeoIp(
  requested: string | boolean | undefined,
  proxy: CamoufoxLaunchOptions["proxy"],
): Promise<string | boolean> {
  if (typeof requested === "string" && requested.length > 0) return requested
  if (requested === false) return false
  if (!proxy) return false
  try {
    const lookup = await resolveProxyEgressIp(proxy)
    appendServerLog(CAMOUFOX_LOG_PATH, "diag", {
      stage: "resolveGeoIp:resolved",
      ip: lookup.ip,
      resolvedAt: lookup.resolvedAt,
    })
    return lookup.ip
  } catch (err) {
    appendServerLog(CAMOUFOX_LOG_PATH, "warn", {
      stage: "resolveGeoIp:fallback-auto",
      error: err instanceof Error ? err.message : String(err),
    })
    return true
  }
}



async function adaptResult(
  result: Browser | BrowserContext,
  window: CamoufoxLaunchOptions["window"],
  proxy: EngineProxy | undefined,
): Promise<EngineInstance> {
  const isBrowser = "contexts" in result
  const browser = isBrowser ? (result as Browser) : undefined
  let context: BrowserContext
  if (isBrowser) {
    const existing = (result as Browser).contexts()
    context = existing[0] ?? (await (result as Browser).newContext())
  } else {
    context = result as BrowserContext
  }

  if (!context) {
    throw new Error("Camoufox did not create a default browser context")
  }

  attachViewportCoherence(context, window)

  return {
    browser: browser ?? (context.browser()!),
    defaultContext: context,
    newPage: () => context.newPage(),
    close: async () => {
      if (browser) {
        await browser.close()
      } else {
        await context.close()
      }
    },
    proxy,
  }
}
