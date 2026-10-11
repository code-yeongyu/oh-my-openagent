import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"

import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"
import { resolveAgentHome } from "../agent-home/resolve-agent-home"
import { loadSenpiOmoConfig } from "../config-resolution"
import { gatewayDatabasePath } from "../thread/gateway/paths"
import { createGatewayStore } from "../thread/gateway/store"
import type { GatewayRulesStore } from "./prompt"
import { createGatewayRulesPromptHandler } from "./prompt"
import { GATEWAY_RULES_EXTENSION_NAME, GATEWAY_RULES_MIGRATIONS } from "./store-extension/migrations"

export { createGatewayRulesPromptHandler, type GatewayRulesPromptOptions, type GatewayRulesStore } from "./prompt"
export { composeGatewayRulesBlock, GATEWAY_RULES_SENTINEL_BEGIN, GATEWAY_RULES_SENTINEL_END, markGatewayRulesBlock, renderOperatingRulesBlock } from "./rules-block"
export { GATEWAY_RULES_EXTENSION_NAME, GATEWAY_RULES_MIGRATIONS } from "./store-extension/migrations"

/** The ops module the plugin build emits beside `omo.js`; the store worker imports it by URL. */
export const GATEWAY_RULES_EXTENSION_BUNDLE_NAME = "gateway-rules-extension.mjs"

export interface GatewayComponentOptions {
  readonly agentDir?: () => string
  readonly createStore?: (agentDir: string) => GatewayRulesStore & { readonly registerStoreExtension: (descriptor: { readonly name: string; readonly migrations: readonly (readonly string[])[]; readonly moduleUrl: string }) => Promise<unknown> }
  /** The raw `gateway` config section; a non-empty `scopes` array activates the component. */
  readonly loadGatewaySection?: () => unknown
  readonly resolveModuleUrl?: () => string | undefined
}

export function createGatewayComponent(options: GatewayComponentOptions = {}): OmoSenpiComponent {
  return {
    name: "gateway",
    register(pi: SenpiExtensionAPI, ctx: ComponentContext): void {
      let store: GatewayRulesStore | undefined
      let settled = false
      let registrationWarned = false
      const handler = createGatewayRulesPromptHandler({
        ensureStore: async () => {
          if (store !== undefined) return store
          if (settled) return undefined
          const section = (options.loadGatewaySection ?? defaultGatewaySection)()
          if (!hasScopes(section)) {
            settled = true
            return undefined
          }
          const agentDir = (options.agentDir ?? defaultAgentDir)()
          if (!existsSync(gatewayDatabasePath(agentDir))) {
            settled = true
            return undefined
          }
          const moduleUrl = (options.resolveModuleUrl ?? defaultResolveModuleUrl)()
          if (moduleUrl === undefined) {
            settled = true
            ctx.logger.debug?.(`gateway rules extension artifact ${GATEWAY_RULES_EXTENSION_BUNDLE_NAME} is not built; rules injection stays off`)
            return undefined
          }
          const created = (options.createStore ?? defaultCreateStore)(agentDir)
          const registered = await created.registerStoreExtension({ name: GATEWAY_RULES_EXTENSION_NAME, migrations: GATEWAY_RULES_MIGRATIONS, moduleUrl })
          if (!isOk(registered)) {
            if (!registrationWarned) {
              registrationWarned = true
              ctx.logger.warn(`gateway rules extension registration failed: ${describeRefusal(registered)}`)
            }
            return undefined
          }
          store = created
          return store
        },
        onLookupError: (message) => ctx.logger.warn(message),
      })
      pi.on("before_agent_start", handler)
    },
  }
}

function hasScopes(section: unknown): boolean {
  if (section === null || typeof section !== "object" || Array.isArray(section)) return false
  const scopes = (section as { readonly scopes?: unknown }).scopes
  return Array.isArray(scopes) && scopes.length > 0
}

function defaultGatewaySection(): unknown {
  return loadSenpiOmoConfig().config.gateway
}

function defaultAgentDir(): string {
  return resolveAgentHome({ env: process.env })
}

function defaultCreateStore(agentDir: string): ReturnType<typeof createGatewayStore> {
  return createGatewayStore({ agentDir })
}

function defaultResolveModuleUrl(): string | undefined {
  const bundled = new URL(`./${GATEWAY_RULES_EXTENSION_BUNDLE_NAME}`, import.meta.url)
  return existsSync(fileURLToPath(bundled)) ? bundled.href : undefined
}

function isOk(result: unknown): result is { readonly kind: "ok" } {
  return result !== null && typeof result === "object" && (result as { readonly kind?: unknown }).kind === "ok"
}

function describeRefusal(result: unknown): string {
  if (result !== null && typeof result === "object") {
    const message = (result as { readonly message?: unknown }).message
    if (typeof message === "string") return message
  }
  return String(result)
}
