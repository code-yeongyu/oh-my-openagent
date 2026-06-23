import { load, YAMLException } from "js-yaml"
import {
  DeliberationRequestSchema,
  type DeliberationRequest,
  type DeliberationResponse,
} from "../../agents/themis/types"
import { log } from "../../shared"
import { getOptionSelectionKeys } from "./option-selection-key"
import {
  createCacheKeyGenerator,
  createCacheStore,
  createFormalizationQualityChecker,
  createSchemaParser,
  createSemanticFormalizationService,
  createTheoryValidator,
  FormalizationError,
  type FormalizationRequest,
  type SemanticFormalizationService,
  type Theory,
} from "./semantic-formalization-service"

const formalizationLogger = {
  debug: (msg: string, meta?: Record<string, unknown>) => log(`[deliberation-gate] ${msg}`, meta),
  info: (msg: string, meta?: Record<string, unknown>) => log(`[deliberation-gate] ${msg}`, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => log(`[deliberation-gate] ${msg}`, meta),
}

const defaultFormalizationService = createSemanticFormalizationService({
  llmCaller: { call: async (request) => ({ status: "ok", theory: buildTheory(request) }) },
  schemaParser: createSchemaParser({ logger: formalizationLogger }),
  theoryValidator: createTheoryValidator({ logger: formalizationLogger }),
  qualityChecker: createFormalizationQualityChecker(),
  cacheKeyGen: createCacheKeyGenerator(),
  cacheStore: createCacheStore({ logger: formalizationLogger, persistence: "memory" }),
  logger: formalizationLogger,
  modelId: "deterministic-semantic-formalizer",
  promptVersion: "deliberation-gate-v1",
  schemaVersion: 1,
})

export function getDeliberationFormalizationService(
  service?: SemanticFormalizationService,
): SemanticFormalizationService {
  return service ?? defaultFormalizationService
}

export function parseDeliberationRequest(content: string): DeliberationRequest {
  try {
    const trimmed = content.trim()
    const parsed = trimmed.startsWith("{") || trimmed.startsWith("[") ? JSON.parse(content) : load(content)
    return DeliberationRequestSchema.parse(parsed)
  } catch (error) {
    throw new Error(buildParseErrorMessage(content, error))
  }
}

export function toFormalizationRequest(request: DeliberationRequest): FormalizationRequest {
  return {
    problem_statement: request.problem_statement,
    options: request.options,
    constraints: request.constraints,
    preferences: request.preferences,
    context: request.context,
    requested_semantics: request.requested_semantics,
  }
}

export function createOptionMap(options: string[]): Map<string, string> {
  return new Map(
    options.flatMap((option, index) => getOptionSelectionKeys(option, index).map((key) => [key, option] as const)),
  )
}

export function buildFormalizationFailedResponse(
  request: DeliberationRequest,
  error: FormalizationError,
): DeliberationResponse {
  return {
    verdict: "formalization_failed",
    rationale: error.message,
    proof_chain: [],
    sidecar_trace: { formalization_error_code: error.code },
    provenance: {
      semantics: request.requested_semantics,
      iterations: 0,
      timestamp: new Date().toISOString(),
      input_request: request,
    },
    bundle: null,
    error: error.message,
  }
}

function buildTheory(request: FormalizationRequest): Theory {
  const conditionConclusions = request.constraints.map((constraint, index) => `require_${toSlug(constraint, index)}`)
  const optionRuleIds = new Set(request.options.map((_, index) => `d-option-${index}`))
  const premises: Theory["premises"] = [{ formula: "problem(current)", kind: "ordinary" }]

  if (request.context) {
    premises.push({ formula: "context_available(current)", kind: "ordinary" })
  }

  const optionMarkers = request.options.map((option, index) => {
    const slug = toSlug(option, index)
    return { slug, formula: `support(${slug}) @option:${slug}` }
  })
  for (const marker of optionMarkers) {
    premises.push({ formula: marker.formula, kind: "ordinary" })
  }

  return {
    premises,
    strict_rules: request.constraints.map((constraint, index) => ({
      id: `s-constraint-${index}`,
      antecedents: ["problem(current)"],
      consequent: `require_${toSlug(constraint, index)}`,
    })),
    defeasible_rules: request.options.map((option, index) => ({
      id: `d-option-${index}`,
      antecedents: ["problem(current)", ...conditionConclusions, optionMarkers[index].formula],
      consequent: `select_${toSlug(option, index)}`,
    })),
    preferences: request.preferences.filter((preference) => {
      return optionRuleIds.has(preference.superior) && optionRuleIds.has(preference.inferior)
    }),
    classical_negation: true,
  }
}

function buildParseErrorMessage(content: string, error: unknown): string {
  if (error instanceof YAMLException && error.mark) {
    return `Deliberation request parse failed at line ${error.mark.line + 1}: ${error.message}`
  }

  if (error instanceof SyntaxError) {
    const match = error.message.match(/position (\d+)/i)
    if (match) {
      const position = Number(match[1])
      const line = content.slice(0, position).split(/\r?\n/).length
      return `Deliberation request parse failed at line ${line}: ${error.message}`
    }
  }

  const message = error instanceof Error ? error.message : String(error)
  return `Deliberation request parse failed at line 1: ${message}`
}

function toSlug(value: string, index: number): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
  return slug.length > 0 ? slug : `option_${index}`
}
