import type { BrowserAutomationConfig } from "../../config/schema/browser-automation"
import type { BrowserPoolConfig } from "../../mcp/idm-browser/pool"
import type { FingerprintFamily } from "../fingerprint"
import type { InitScript } from "../init-scripts"
import { applyInitScripts } from "../init-scripts"
import { buildContextOptionsFromFamily } from "./context-options"
import { buildNavigatorOverrideScript } from "./init-script"

export type BuildPoolConfigInput = {
  proxy?: BrowserAutomationConfig["proxy"]
  engine?: "camoufox" | "patchright" | "lightpanda" | "cloakbrowser"
  locale?: string
  humanize?: boolean
  poolMaxConcurrent?: number
  idleTimeoutMs?: number
  family?: FingerprintFamily
  initScripts?: InitScript[]
}

export function buildPoolConfigFromSession(input: BuildPoolConfigInput): BrowserPoolConfig {
  const family = input.family
  const locale = family?.locale ?? input.locale ?? "it-IT"
  const familyScriptSource = family ? buildNavigatorOverrideScript(family) : undefined
  const contextOptions = family ? buildContextOptionsFromFamily(family) : undefined

  const allInitScripts: InitScript[] = []
  if (familyScriptSource) {
    allInitScripts.push({ name: "navigator-override", source: familyScriptSource })
  }
  if (input.initScripts) {
    allInitScripts.push(...input.initScripts)
  }

  const config: BrowserPoolConfig = {
    maxConcurrent: input.poolMaxConcurrent ?? 1,
    idleTimeoutMs: input.idleTimeoutMs ?? 600_000,
    engineOptions: {
      engine: input.engine ?? "camoufox",
      locale,
      humanize: input.humanize ?? true,
      os: ["windows", "macos"],
      proxy: input.proxy
        ? { server: "", ...input.proxy as Record<string, unknown> } as never
        : undefined,
      ...(family
        ? {
            firefox_user_prefs: {
              "general.useragent.override": family.userAgent,
            },
            window: { width: family.viewport.width, height: family.viewport.height } as never,
          }
        : {}),
    },
  }
  if (contextOptions) config.contextOptions = contextOptions
  if (allInitScripts.length > 0) {
    config.contextDecorator = async (ctx) => {
      await applyInitScripts(ctx, allInitScripts)
    }
  }
  return config
}
