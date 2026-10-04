import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"

import type { ComponentLogger } from "../../extension/types"
import { resolveAgentHome } from "../agent-home/resolve-agent-home"
import { loadSenpiOmoConfig } from "../config-resolution"
import { gatewayDatabasePath } from "../thread/gateway/paths"
import { createGatewayStore } from "../thread/gateway/store"
import type { GatewayRulesStore } from "./prompt"
import { GATEWAY_RULES_EXTENSION_NAME, GATEWAY_RULES_MIGRATIONS } from "./store-extension/migrations"
import { GATEWAY_RULES_SESSION_OPS } from "./store-extension/session-ops"
import type { StoreExtensionRegistration } from "../thread/gateway/store-extensions"

export const GATEWAY_RULES_EXTENSION_BUNDLE_NAME = "gateway-rules-extension.mjs"

export interface GatewayConnectionOptions {
  readonly agentDir?: () => string
  readonly createStore?: (agentDir: string) => GatewayRulesStore & { readonly registerStoreExtension: (descriptor: StoreExtensionRegistration) => Promise<unknown> }
  readonly loadGatewaySection?: () => unknown
  readonly resolveModuleUrl?: () => string | undefined
}

export function createGatewayConnection(options: GatewayConnectionOptions, logger: ComponentLogger) {
  let store: GatewayRulesStore | undefined
  let settled = false
  let registrationWarned = false
  let opening: Promise<GatewayRulesStore | undefined> | undefined
  const open = async () => {
    const section = (options.loadGatewaySection ?? (() => loadSenpiOmoConfig().config.gateway))()
    if (!hasScopes(section)) { settled = true; return undefined }
    const agentDir = (options.agentDir ?? (() => resolveAgentHome({ env: process.env })))()
    if (!existsSync(gatewayDatabasePath(agentDir))) { settled = true; return undefined }
    const moduleUrl = (options.resolveModuleUrl ?? defaultResolveModuleUrl)()
    if (moduleUrl === undefined) {
      settled = true
      logger.debug?.(`gateway rules extension artifact ${GATEWAY_RULES_EXTENSION_BUNDLE_NAME} is not built; rules injection stays off`)
      return undefined
    }
    const created = (options.createStore ?? ((agentDir) => createGatewayStore({ agentDir })))(agentDir)
    const registered = await created.registerStoreExtension({ name: GATEWAY_RULES_EXTENSION_NAME, migrations: GATEWAY_RULES_MIGRATIONS, moduleUrl, sessionCallable: GATEWAY_RULES_SESSION_OPS })
    if (registered === null || typeof registered !== "object" || Reflect.get(registered, "kind") !== "ok") {
      if (!registrationWarned) {
        registrationWarned = true
        logger.warn(`gateway rules extension registration failed: ${describeRefusal(registered)}`)
      }
      return undefined
    }
    store = created
    return store
  }
  return async () => {
    if (store !== undefined) return store
    if (settled) return undefined
    opening ??= open()
    try { return await opening } finally { opening = undefined }
  }
}

function hasScopes(section: unknown): boolean {
  if (section === null || typeof section !== "object" || Array.isArray(section)) return false
  const scopes: unknown = Reflect.get(section, "scopes")
  return Array.isArray(scopes) && scopes.length > 0
}

function defaultResolveModuleUrl(): string | undefined {
  const bundled = new URL(`./${GATEWAY_RULES_EXTENSION_BUNDLE_NAME}`, import.meta.url)
  return existsSync(fileURLToPath(bundled)) ? bundled.href : undefined
}

function describeRefusal(result: unknown): string {
  if (result !== null && typeof result === "object") {
    const message: unknown = Reflect.get(result, "message")
    if (typeof message === "string") return message
  }
  return String(result)
}
