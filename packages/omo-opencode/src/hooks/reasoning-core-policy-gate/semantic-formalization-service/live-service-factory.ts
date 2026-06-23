import type { FormalizationRequest } from "./types"
import { FormalizationError } from "./errors"
import { createSubagentLLMCaller, type SubagentLLMCaller } from "./subagent-llm-caller"
import { createFormalizationQualityChecker } from "./formalization-quality-checker"
import { createSchemaParser } from "./schema-parser"
import { createTheoryValidator } from "./theory-validator"
import { createCacheKeyGenerator } from "./cache-key"
import { createCacheStore } from "./cache-store"
import { createSemanticFormalizationService, type SemanticFormalizationService } from "./service"
import { log } from "../../../shared/logger"

type PluginTaskTool = {
  execute(args: Record<string, unknown>, context: unknown): Promise<unknown>
}

type PluginContext = {
  sessionID: string
  metadata?: (data: Record<string, unknown>) => void
}

type CreateLiveServiceDeps = {
  delegateTaskTool?: PluginTaskTool
  pluginContext?: PluginContext
  modelId?: string
  modelVersion?: string
  promptVersion?: string
  schemaVersion?: number
}

const serviceLogger = {
  debug: (msg: string, meta?: Record<string, unknown>) => log(`[formalization-service] ${msg}`, meta),
  info: (msg: string, meta?: Record<string, unknown>) => log(`[formalization-service] ${msg}`, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => log(`[formalization-service] ${msg}`, meta),
}

export function createLiveFormalizationService(deps: CreateLiveServiceDeps = {}): SemanticFormalizationService {
  const modelId = deps.modelId ?? process.env.THEMIS_FORMALIZATION_MODEL_ID ?? "formalizer-subagent-default"
  const modelVersion = deps.modelVersion ?? process.env.THEMIS_FORMALIZATION_MODEL_VERSION
  const promptVersion = deps.promptVersion ?? process.env.THEMIS_FORMALIZATION_PROMPT_VERSION ?? "1.0.0"
  const schemaVersion = deps.schemaVersion ?? Number(process.env.THEMIS_FORMALIZATION_SCHEMA_VERSION ?? "1")

  const llmCaller = createSubagentLLMCaller({
    taskDispatcher: {
      async dispatch(params) {
        if (deps.delegateTaskTool && deps.pluginContext) {
          const result = await deps.delegateTaskTool.execute(
            {
              subagent_type: params.subagentType,
              load_skills: params.loadSkills,
              prompt: params.prompt,
              description: params.description,
              run_in_background: false,
            },
            deps.pluginContext,
          )
          return typeof result === "string" ? result : JSON.stringify(result)
        }

        throw new FormalizationError({
          code: "provider_failure",
          message: "No delegate task tool available for formalization subagent dispatch",
        })
      },
    },
    subagentType: "formalizer",
    skills: [],
    timeoutMs: 180_000,
  })

  return createSemanticFormalizationService({
    llmCaller,
    schemaParser: createSchemaParser({ logger: serviceLogger }),
    theoryValidator: createTheoryValidator({ logger: serviceLogger }),
    qualityChecker: createFormalizationQualityChecker(),
    cacheKeyGen: createCacheKeyGenerator(),
    cacheStore: createCacheStore({ logger: serviceLogger }),
    logger: serviceLogger,
    modelId,
    modelVersion,
    promptVersion,
    schemaVersion,
  })
}
