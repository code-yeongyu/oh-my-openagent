import type { Browser, BrowserContext, Page } from "playwright-core"
import type { LaunchOptions, LaunchPersistentContextOptions } from "cloakbrowser"
import type { EngineInstance, EngineProxy, CamoufoxLaunchOptions } from "./camoufox-engine"

export type CloakProxy = NonNullable<LaunchOptions["proxy"]>

export type CloakBrowserLaunchOptions = {
  headless?: boolean
  proxy?: CloakProxy
  args?: string[]
  extensionPaths?: string[]
  stealthArgs?: boolean
  timezone?: string
  locale?: string
  geoip?: boolean
  humanize?: boolean
  humanPreset?: "default" | "careful"
  userDataDir?: string
  userAgent?: string
  viewport?: { width: number; height: number }
}

export function normalizeCloakProxy(proxy: CamoufoxLaunchOptions["proxy"]): CloakProxy | undefined {
  if (!proxy) return undefined
  if (typeof proxy === "string") return proxy
  return {
    server: proxy.server,
    ...(proxy.bypass ? { bypass: proxy.bypass } : {}),
    ...(proxy.username ? { username: proxy.username } : {}),
    ...(proxy.password ? { password: proxy.password } : {}),
  }
}

function buildArgs(options: CloakBrowserLaunchOptions): string[] | undefined {
  const args = [...(options.args ?? [])]
  if (options.viewport && !args.some((a) => a.startsWith("--window-size"))) {
    args.push(`--window-size=${options.viewport.width},${options.viewport.height}`)
  }
  return args.length > 0 ? args : undefined
}

function buildBaseOptions(options: CloakBrowserLaunchOptions): LaunchOptions {
  const headlessDefault = process.env.BROWSER_HEADLESS === "false" ? false : true
  return {
    headless: options.headless ?? headlessDefault,
    proxy: options.proxy,
    args: buildArgs(options),
    extensionPaths: options.extensionPaths,
    stealthArgs: options.stealthArgs ?? true,
    timezone: options.timezone,
    locale: options.locale,
    geoip: options.geoip,
    humanize: options.humanize ?? true,
    humanPreset: options.humanPreset,
  }
}

export async function launchCloakbrowser(options: CloakBrowserLaunchOptions = {}): Promise<EngineInstance> {
  const cloakbrowserModuleName = "cloakbrowser"
  const { launch, launchPersistentContext } = (await import(cloakbrowserModuleName)) as typeof import("cloakbrowser")

  const base = buildBaseOptions(options)

  if (options.userDataDir) {
    const persistentOpts: LaunchPersistentContextOptions = {
      ...base,
      userDataDir: options.userDataDir,
      ...(options.userAgent ? { userAgent: options.userAgent } : {}),
      ...(options.viewport ? { viewport: options.viewport } : {}),
    }
    const context = await launchPersistentContext(persistentOpts)
    return adaptResult(context, toEngineProxy(options.proxy))
  }

  const browser = await launch(base)
  return adaptResult(browser, toEngineProxy(options.proxy))
}

function toEngineProxy(proxy: CloakProxy | undefined): EngineProxy | undefined {
  if (!proxy) return undefined
  if (typeof proxy === "string") return { server: proxy }
  return proxy
}

async function adaptResult(result: Browser | BrowserContext, proxy: EngineProxy | undefined): Promise<EngineInstance> {
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
    throw new Error("CloakBrowser did not create a default browser context")
  }
  return {
    browser: browser ?? context.browser()!,
    defaultContext: context,
    newPage: (): Promise<Page> => context.newPage(),
    close: async (): Promise<void> => {
      if (browser) {
        await browser.close()
      } else {
        await context.close()
      }
    },
    proxy,
  }
}
