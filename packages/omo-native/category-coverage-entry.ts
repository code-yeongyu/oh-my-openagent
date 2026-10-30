/**
 * The category-coverage runtime `omo doctor` and `omo setup` import from the staged payload
 * (`plugin/runtime/category-coverage/index.js`, bundled by script/build-omo-native.ts). The launcher
 * is plain JS and cannot load TypeScript sources, so this bundle is how it reaches the one resolver
 * the spawn path gates categories with, instead of a copy of the chains.
 */

import { loadOmoConfig, type OmoConfigEnv } from "@oh-my-opencode/omo-config-core"
import { resolveCategoryCoverage, type CategoryCoverage } from "@oh-my-opencode/senpi-task/category-coverage"
import { describeModelChains, type ModelChainsReport } from "@oh-my-opencode/senpi-task/model-chains"
import { loadSenpiOmoConfig } from "../omo-senpi/src/components/config-resolution"
import { describeModelProfile, type ModelProfileView } from "../omo-senpi/src/components/model-profile/describe"
export { computerUseDoctorReport } from "./computer-use-doctor-runtime"
export { configDoctorLines } from "./config-doctor-runtime"

export type CategoryCoverageInput = {
  // The engine's available models: provider id and model id per entry.
  readonly models: readonly { readonly provider: string; readonly id: string }[]
  readonly cwd: string
  readonly env: OmoConfigEnv
  // Categories a setup plan is about to pin in omo.json; they count as user-configured.
  readonly pinnedCategories?: readonly string[]
}

export type ModelChainsView = ModelChainsReport & {
  readonly configProfile?: string
  readonly modelProfile: ModelProfileView
}

/**
 * `omo doctor --models`: every category and task agent as the spawn resolvers resolve them, and the
 * main session's model_profile lane, over the config view the task component loads (catalog
 * references expanded) and the engine's available models.
 */
export function modelChains(input: CategoryCoverageInput): ModelChainsView {
  const { config, profile } = loadSenpiOmoConfig({ cwd: input.cwd, env: input.env })
  const models = input.models.map((model) => ({ provider: model.provider, id: model.id }))
  const report = describeModelChains(config, {
    getAvailable: () => models,
    find: (provider, modelId) => models.find((model) => model.provider === provider && model.id === modelId),
  })
  return {
    ...report,
    ...(profile === undefined ? {} : { configProfile: profile }),
    modelProfile: describeModelProfile(config, models.map((model) => `${model.provider}/${model.id}`)),
  }
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
