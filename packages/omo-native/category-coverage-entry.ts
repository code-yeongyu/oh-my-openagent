/**
 * The category-coverage runtime `omo doctor` and `omo setup` import from the staged payload
 * (`plugin/runtime/category-coverage/index.js`, bundled by script/build-omo-native.ts). The launcher
 * is plain JS and cannot load TypeScript sources, so this bundle is how it reaches the one resolver
 * the spawn path gates categories with, instead of a copy of the chains.
 */

import { loadOmoConfig, type OmoConfigEnv } from "@oh-my-opencode/omo-config-core"
import { resolveCategoryCoverage, type CategoryCoverage } from "@oh-my-opencode/senpi-task/category-coverage"
export { computerUseDoctorReport } from "./computer-use-doctor-runtime"

export type CategoryCoverageInput = {
  // The engine's available models: provider id and model id per entry.
  readonly models: readonly { readonly provider: string; readonly id: string }[]
  readonly cwd: string
  readonly env: OmoConfigEnv
  // Categories a setup plan is about to pin in omo.json; they count as user-configured.
  readonly pinnedCategories?: readonly string[]
}

export function categoryCoverage(input: CategoryCoverageInput): CategoryCoverage {
  // The same config view the extension loads (omo-senpi config-resolution: harness "senpi").
  const { config } = loadOmoConfig({ cwd: input.cwd, env: input.env, harness: "senpi" })
  const pinned = Object.fromEntries((input.pinnedCategories ?? []).map((name) => [name, {}]))
  const models = input.models.map((model) => ({ provider: model.provider, id: model.id }))
  return resolveCategoryCoverage(
    { ...config, categories: { ...pinned, ...config.categories } },
    {
      getAvailable: () => models,
      find: (provider, modelId) => models.find((model) => model.provider === provider && model.id === modelId),
    },
  )
}
