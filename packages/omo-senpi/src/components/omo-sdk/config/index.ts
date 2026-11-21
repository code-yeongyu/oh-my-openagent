import {
  loadOmoConfig,
  type OmoConfigDiagnostic,
  type OmoConfigEnv,
  type OmoConfigSource,
} from "@oh-my-opencode/omo-config-core"
import { failure } from "../access"
import { ok, type OmoResult } from "../result"

export type ConfigStatus = {
  readonly files: readonly OmoConfigSource[]
  readonly diagnostics: readonly OmoConfigDiagnostic[]
}

export type ConfigApi = { readonly status: () => Promise<OmoResult<ConfigStatus>> }

export function createConfigApi(options: { readonly cwd: string; readonly env: OmoConfigEnv }): ConfigApi {
  return {
    async status() {
      try {
        const { sources, diagnostics } = loadOmoConfig({ cwd: options.cwd, env: options.env, harness: "senpi" })
        return ok({ files: sources, diagnostics })
      } catch (error) {
        return failure(error)
      }
    },
  }
}
