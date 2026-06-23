import type { EngineName } from "../types"
import type { EngineInstance, CamoufoxLaunchOptions } from "./camoufox-engine"
import type { CloakBrowserLaunchOptions } from "./cloakbrowser-engine"

export type EngineDispatchOptions = CamoufoxLaunchOptions & {
  engine?: EngineName
  cloakbrowser?: CloakBrowserLaunchOptions
}

export async function dispatchEngine(options: EngineDispatchOptions = {}): Promise<EngineInstance> {
  const engine = options.engine ?? "camoufox"

  switch (engine) {
    case "camoufox": {
      const { launchCamoufox } = await import("./camoufox-engine")
      return launchCamoufox(options)
    }
    case "cloakbrowser": {
      const { launchCloakbrowser, normalizeCloakProxy } = await import("./cloakbrowser-engine")
      const cbOpts: CloakBrowserLaunchOptions = options.cloakbrowser ?? {}
      const proxy = cbOpts.proxy ?? normalizeCloakProxy(options.proxy)
      const merged: CloakBrowserLaunchOptions = {
        ...cbOpts,
        headless: cbOpts.headless ?? (typeof options.headless === "boolean" ? options.headless : undefined),
        proxy,
        geoip: cbOpts.geoip ?? (proxy ? true : undefined),
        locale: cbOpts.locale ?? (Array.isArray(options.locale) ? options.locale[0] : options.locale),
        humanize: cbOpts.humanize ?? (typeof options.humanize === "boolean" ? options.humanize : undefined),
      }
      return launchCloakbrowser(merged)
    }
    case "patchright": {
      const { launchPatchright } = await import("./patchright-engine")
      return launchPatchright()
    }
    case "lightpanda": {
      const { launchLightpanda } = await import("./lightpanda-engine")
      return launchLightpanda()
    }
    default:
      throw new Error(`Unknown engine: ${engine satisfies never}`)
  }
}
