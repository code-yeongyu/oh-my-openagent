import { FormalizationError } from "./errors"
import type { FormalizationQualityChecker } from "./formalization-quality-checker"
import type { FormalizationEnvelope, FormalizationRequest, FormalizationResult, Theory } from "./types"

type CacheVersions = {
  modelId: string
  modelVersion?: string
  promptVersion: string
  schemaVersion: number
  mode: "permissive" | "strict"
}

type CachedTheory = {
  theory: Theory
  createdAt: number
  modelId: string
  promptVersion: string
  schemaVersion: number
}

type FormalizationQualityRetryFeedback = {
  qualityWarnings: string[]
}

type LLMCaller = { call(request: FormalizationRequest, feedback?: FormalizationQualityRetryFeedback): Promise<FormalizationEnvelope> }
type SchemaParser = { parse(rawTheory: unknown): Theory }
type TheoryValidator = { validate(theory: Theory, expectedOptionAtoms?: string[]): Theory }
type CacheKeyGenerator = { generate(request: unknown, versions: CacheVersions): string }
type CacheStore = {
  get(key: string): CachedTheory | undefined
  set(key: string, value: CachedTheory): void
  has(key: string): boolean
}
type Logger = {
  debug(msg: string, meta?: Record<string, unknown>): void
  info(msg: string, meta?: Record<string, unknown>): void
  warn(msg: string, meta?: Record<string, unknown>): void
}

export type ServiceDeps = {
  llmCaller: LLMCaller
  schemaParser: SchemaParser
  theoryValidator: TheoryValidator
  qualityChecker: FormalizationQualityChecker
  cacheKeyGen: CacheKeyGenerator
  cacheStore: CacheStore
  logger: Logger
  modelId: string
  modelVersion?: string
  promptVersion: string
  schemaVersion: number
}

export type FormalizeOptions = {
  mode?: "permissive" | "strict"
  isInteractive?: boolean
  expectedOptionAtoms?: string[]
}

export type SemanticFormalizationService = {
  formalize(request: FormalizationRequest, options?: FormalizeOptions): Promise<FormalizationResult>
}

export function createSemanticFormalizationService(
  deps: ServiceDeps,
): SemanticFormalizationService {
  const {
    llmCaller,
    schemaParser,
    theoryValidator,
    qualityChecker,
    cacheKeyGen,
    cacheStore,
    logger,
    modelId,
    modelVersion,
    promptVersion,
    schemaVersion,
  } = deps

  return {
    async formalize(
      request: FormalizationRequest,
      options: FormalizeOptions = {},
    ): Promise<FormalizationResult> {
      const mode = options.mode ?? "permissive"
      const isInteractive = options.isInteractive ?? false

      if (mode === "strict" && !isInteractive) {
        throw new FormalizationError({
          code: "confirmation_required",
          message: "Strict mode requires interactive confirmation",
        })
      }

      const versions: CacheVersions = {
        modelId,
        modelVersion,
        promptVersion,
        schemaVersion,
        mode,
      }
      const cacheKey = cacheKeyGen.generate(request, versions)
      const cached = cacheStore.get(cacheKey)

      if (cached) {
        logger.debug("service: cache hit", { cacheKey })
        return {
          theory: cached.theory,
          provenance: {
            model_id: modelId,
            model_version: modelVersion,
            prompt_version: promptVersion,
            schema_version: schemaVersion,
            mode,
            cache_hit: true,
            iterations_attempted: 0,
            derived_theory: cached.theory,
          },
        }
      }

      logger.debug("service: cache miss, calling LLM", { cacheKey })
      const { theory: validatedTheory, iterationsAttempted } = await formalizeWithQualityRetry({
        llmCaller,
        schemaParser,
        theoryValidator,
        qualityChecker,
        request,
        expectedOptionAtoms: options.expectedOptionAtoms,
      })

      cacheStore.set(cacheKey, {
        theory: validatedTheory,
        createdAt: Date.now(),
        modelId,
        promptVersion,
        schemaVersion,
      })

      if (mode === "strict") {
        logger.info("service: theory formalized (strict mode)", {
          modelId,
          promptVersion,
        })
      }

      return {
        theory: validatedTheory,
        provenance: {
          model_id: modelId,
          model_version: modelVersion,
          prompt_version: promptVersion,
          schema_version: schemaVersion,
          mode,
          cache_hit: false,
          iterations_attempted: iterationsAttempted,
          derived_theory: validatedTheory,
        },
      }
    },
  }
}

async function formalizeWithQualityRetry(input: {
  llmCaller: LLMCaller
  schemaParser: SchemaParser
  theoryValidator: TheoryValidator
  qualityChecker: FormalizationQualityChecker
  request: FormalizationRequest
  expectedOptionAtoms?: string[]
}): Promise<{ theory: Theory; iterationsAttempted: number }> {
  let feedback: FormalizationQualityRetryFeedback | undefined

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const envelope = await input.llmCaller.call(input.request, feedback)
    if (envelope.status === "error") {
      throw new FormalizationError({
        code: mapEnvelopeErrorCode(envelope.error_code),
        message: envelope.message,
        details: { recoverable: envelope.recoverable },
      })
    }

    const parsedTheory = input.schemaParser.parse(envelope.theory)
    const validatedTheory = input.theoryValidator.validate(parsedTheory, input.expectedOptionAtoms)
    const qualityReport = input.qualityChecker.check({
      request: input.request,
      theory: validatedTheory,
      expectedOptionAtoms: input.expectedOptionAtoms,
    })

    if (qualityReport.isAcceptable) {
      return { theory: validatedTheory, iterationsAttempted: attempt + 1 }
    }

    feedback = { qualityWarnings: qualityReport.qualityWarnings }
  }

  throw new FormalizationError({
    code: "theory_invalid",
    message: "Formalized theory failed quality checks after one retry",
    details: { violation: "quality_unacceptable" },
  })
}

function mapEnvelopeErrorCode(errorCode: "invalid_json" | "schema_mismatch" | "missing_theory" | "malformed_theory") {
  switch (errorCode) {
    case "missing_theory":
      return "missing_theory" as const
    case "malformed_theory":
      return "malformed_theory" as const
    default:
      return "schema_invalid" as const
  }
}
