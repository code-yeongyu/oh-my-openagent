import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"
import { resolveAgentHome } from "../agent-home/resolve-agent-home"
import { hasOpenferenceCredential } from "./auth"
import { mergeOpenferenceProvider } from "./merge"
import catalogJson from "./openference-senpi-models.json"
import type { OpenferenceSenpiCatalog } from "./types"

export { hasOpenferenceCredential } from "./auth"
export {
  mergeOpenferenceProvider,
  OPENFERENCE_PROVIDER_ID,
  OPENFERENCE_BASE_URL,
  OPENFERENCE_ENV_VAR,
  OPENFERENCE_USER_AGENT,
} from "./merge"

export const OPENFERENCE_PROVIDER_COMPONENT_NAME = "openference-provider"

// The generated catalog is a JSON array of Pi model entries; the JSON import's
// inferred shape crosses the boundary once, like any external payload.
const catalog = catalogJson as unknown as OpenferenceSenpiCatalog

export interface OpenferenceProviderComponentOptions {
  /** Overrides agent-home resolution; tests point it at a temp dir holding models.json. */
  readonly agentDir?: string
  readonly env?: Record<string, string | undefined>
  readonly homeDir?: string
}

/**
 * Credential-gated registration of the openference provider into the engine's
 * models.json (Pi docs/models.md provider-config form).
 *
 * Registration happens at EXTENSION LOAD like x-search: models.json is a small
 * user-owned file and the engine reloads it every /model open, so the write is
 * synchronous, atomic (temp file + rename in the same directory), and needs no
 * restart to take effect. Without a credential (`OPENFERENCE_API_KEY` env var
 * or an `openference` login entry in <agentDir>/auth.json) the file is left
 * byte-identical; with one, the provider block and the bundled catalog are
 * merged fill-only-missing so every user-written value survives verbatim.
 *
 * The block writes `apiKey: "$OPENFERENCE_API_KEY"` (engine env interpolation)
 * and the `User-Agent: pi/openference` header Openference requires - requests
 * without a pi/ User-Agent are rejected with 403 "coding agent required".
 */
export function createOpenferenceProviderComponent(
  options: OpenferenceProviderComponentOptions = {},
): OmoSenpiComponent {
  const env = options.env ?? process.env

  return {
    name: OPENFERENCE_PROVIDER_COMPONENT_NAME,
    register(_pi: SenpiExtensionAPI, ctx: ComponentContext): void {
      const agentDir = options.agentDir ?? resolveAgentHome({ env, homeDir: options.homeDir ?? homedir() })
      if (!hasOpenferenceCredential({ agentDir, env })) {
        // An expected state on machines without Openference credentials: debug
        // channel only, like x-search's skip path.
        ctx.logger.debug?.("openference-provider skipped: no credential", {
          component: OPENFERENCE_PROVIDER_COMPONENT_NAME,
        })
        return
      }

      const modelsJsonPath = join(agentDir, "models.json")
      let existing: unknown = undefined
      if (existsSync(modelsJsonPath)) {
        try {
          existing = JSON.parse(readFileSync(modelsJsonPath, "utf8")) as unknown
        } catch (error) {
          ctx.logger.warn("openference-provider: models.json is not valid JSON; leaving it untouched", {
            component: OPENFERENCE_PROVIDER_COMPONENT_NAME,
            error: String(error),
          })
          return
        }
      }

      const merged = mergeOpenferenceProvider(existing, catalog)
      if (merged === undefined) {
        ctx.logger.warn(
          "openference-provider: models.json has an incompatible providers/openference shape; leaving it untouched",
          { component: OPENFERENCE_PROVIDER_COMPONENT_NAME },
        )
        return
      }
      if (!merged.changed) {
        ctx.logger.debug?.("openference-provider: models.json already up to date", {
          component: OPENFERENCE_PROVIDER_COMPONENT_NAME,
        })
        return
      }

      mkdirSync(agentDir, { recursive: true })
      const tempPath = `${modelsJsonPath}.omo-tmp`
      writeFileSync(tempPath, `${JSON.stringify(merged.doc, undefined, 2)}\n`, "utf8")
      renameSync(tempPath, modelsJsonPath)
      ctx.logger.debug?.(`openference-provider: registered ${catalog.length} models into models.json`, {
        component: OPENFERENCE_PROVIDER_COMPONENT_NAME,
      })
    },
  }
}
