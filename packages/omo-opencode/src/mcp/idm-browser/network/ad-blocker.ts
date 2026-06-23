import type { BrowserContext } from "playwright-core"
import { isAdBlockerDomain } from "./ad-blocker-domains"

export type AdBlockerInstallResult = {
  uninstall: () => Promise<void>
}

export async function installAdBlocker(context: BrowserContext): Promise<AdBlockerInstallResult> {
  const handler = async (route: import("playwright-core").Route): Promise<void> => {
    const url = route.request().url()
    let host = ""
    try {
      host = new URL(url).hostname
    } catch {
      await route.continue()
      return
    }
    if (isAdBlockerDomain(host)) {
      await route.abort("blockedbyclient").catch(() => undefined)
      return
    }
    await route.continue()
  }

  await context.route("**/*", handler)

  return {
    uninstall: async () => {
      await context.unroute("**/*", handler).catch(() => undefined)
    },
  }
}
