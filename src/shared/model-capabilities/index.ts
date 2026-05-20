import {
  getBundledModelCapabilitiesSnapshot,
  getModelCapabilities as getModelCapabilitiesFromCore,
} from "@oh-my-opencode/model-core"
import type { GetModelCapabilitiesInput, ModelCapabilities } from "@oh-my-opencode/model-core"
import * as connectedProvidersCache from "../connected-providers-cache"

export { getBundledModelCapabilitiesSnapshot }

export function getModelCapabilities(input: GetModelCapabilitiesInput): ModelCapabilities {
  return getModelCapabilitiesFromCore({
    ...input,
    providerCache: input.providerCache ?? connectedProvidersCache,
  })
}
export type {
  GetModelCapabilitiesInput,
  ModelCapabilities,
  ModelCapabilitiesDiagnostics,
  ModelCapabilitiesSnapshot,
  ModelCapabilitiesSnapshotEntry,
} from "@oh-my-opencode/model-core"
