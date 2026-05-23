import {
  _setModelResolutionLogImplementationForTesting,
  resolveModelPipeline as resolveModelPipelineFromCore,
} from "@oh-my-opencode/model-core"
import type {
  PipelineModelResolutionRequest,
  PipelineModelResolutionResult,
} from "@oh-my-opencode/model-core"
import * as connectedProvidersCache from "./connected-providers-cache"

export { _setModelResolutionLogImplementationForTesting }

export function resolveModelPipeline(
  request: PipelineModelResolutionRequest,
): PipelineModelResolutionResult | undefined {
  return resolveModelPipelineFromCore(request, connectedProvidersCache)
}
export type {
  PipelineModelResolutionRequest as ModelResolutionRequest,
  PipelineModelResolutionProvenance as ModelResolutionProvenance,
  PipelineModelResolutionResult as ModelResolutionResult,
} from "@oh-my-opencode/model-core"
