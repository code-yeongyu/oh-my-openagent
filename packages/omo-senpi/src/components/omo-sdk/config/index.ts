import {
  loadOmoConfig,
  type OmoConfigDiagnostic,
  type OmoConfigEnv,
  type OmoConfigSource,
} from "@oh-my-opencode/omo-config-core"
import { failure } from "../access"
import { ok, type OmoResult } from "../result"

/**
 * The configuration as the SDK reports it: each file by its scope, with whether it exists and loaded, and the load's
 * diagnostics by kind and count. A file's path and a diagnostic's text stay with the command a person runs (`omo
 * doctor`), which renders the same core's result in full.
 */
export type ConfigStatus = {
  readonly files: readonly {
    readonly scope: OmoConfigSource["scope"]
    readonly exists: boolean
    readonly loaded: boolean
  }[]
  readonly diagnostics: readonly { readonly kind: OmoConfigDiagnostic["kind"]; readonly count: number }[]
}

export type ConfigApi = { readonly status: () => Promise<OmoResult<ConfigStatus>> }

function byKind(diagnostics: readonly OmoConfigDiagnostic[]): ConfigStatus["diagnostics"] {
  const counts = new Map<OmoConfigDiagnostic["kind"], number>()
  for (const { kind } of diagnostics) counts.set(kind, (counts.get(kind) ?? 0) + 1)
  return [...counts].map(([kind, count]) => ({ kind, count }))
}

export function createConfigApi(options: { readonly cwd: string; readonly env: OmoConfigEnv }): ConfigApi {
  return {
    async status() {
      try {
        const { sources, diagnostics } = loadOmoConfig({ cwd: options.cwd, env: options.env, harness: "senpi" })
        return ok({
          files: sources.map(({ scope, exists, loaded }) => ({ scope, exists, loaded })),
          diagnostics: byKind(diagnostics),
        })
      } catch (error) {
        return failure(error)
      }
    },
  }
}
