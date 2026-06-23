import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import {
  createReasoningCoreClient,
  type ReasoningCoreClient,
} from "../../hooks/reasoning-core-policy-gate/reasoning-core-client"
import type { AgmRevisionTheory } from "../../hooks/reasoning-core-policy-gate/belief-revision"
import {
  FormalizationError,
  type FormalizationErrorCode,
  type SemanticFormalizationService,
} from "../../hooks/reasoning-core-policy-gate/semantic-formalization-service"
import * as failureResponse from "./failure-response"
import { maybeApplyAgmRevision } from "./agm-revision-fallback"
import { runDeliberationRound } from "./deliberation-round"
import { mergeContext as mergeDeliberationContext } from "./merge-context"
import { buildSuccessResponseJson } from "./success-response-json"
import {
  buildFormalizationBlock,
  createDefaultSemanticService,
  createOptionMap,
  toFormalizationProvenanceBlock,
  type FormalizationBlock,
} from "./formalization-helpers"
import { queryContext, storePattern } from "../../hooks/reasoning-core-policy-gate/kb-deliberation-bridge"
import { writeDeliberationArtifact } from "./write-deliberation-artifact"

const SEMANTICS = ["grounded", "preferred", "stable", "complete"] as const

const PREFERENCE_SCHEMA = tool.schema.object({
  superior: tool.schema.string(),
  inferior: tool.schema.string(),
})

type DelegateTaskTool = {
  execute(args: Record<string, unknown>, context: unknown): Promise<unknown>
}

type ToolExecuteContext = {
  sessionID: string
  metadata?: (data: Record<string, unknown>) => void
}

export function createSubmitDeliberationTool(deps?: {
  client?: ReasoningCoreClient
  workspaceRoot?: string
  runRound?: typeof runDeliberationRound
  applyAgmRevision?: typeof maybeApplyAgmRevision
  formalizationService?: SemanticFormalizationService
  delegateTaskTool?: DelegateTaskTool
}): ToolDefinition {
  const workspaceRoot = deps?.workspaceRoot ?? process.cwd()
  const reasoningCoreClient = deps?.client ?? createReasoningCoreClient()
  const runRound = deps?.runRound ?? runDeliberationRound
  const applyAgmRevision = deps?.applyAgmRevision ?? maybeApplyAgmRevision

  return tool({
    description:
      "Submit a structured DeliberationRequest to the Themis pipeline. NL→ASPIC+→verdict pipeline: when 'theory' is absent and a Formalizer service is wired, automatically formalizes the request via the Formalizer subagent before solving. When 'theory' is provided, treats it as pre-formalized ASPIC+ JSON and skips formalization.",
    args: {
      id: tool.schema.string().describe("Unique identifier for this deliberation (used as filename stem)"),
      timestamp: tool.schema.string().describe("ISO-8601 timestamp of the request"),
      problem_statement: tool.schema.string().describe("Clear description of the decision to be made"),
      options: tool.schema.array(tool.schema.string()).describe("Candidate policies or actions"),
      constraints: tool.schema.array(tool.schema.string()).describe("Hard requirements (strict rules)"),
      preferences: tool.schema.array(PREFERENCE_SCHEMA).describe("Ordered {superior, inferior} preference pairs"),
      context: tool.schema.string().optional().describe("Optional background information"),
      requested_semantics: tool.schema.enum(SEMANTICS).describe("ASPIC+ semantics: grounded | preferred | stable | complete"),
      theory: tool.schema.string().optional().describe("Pre-formalized ASPIC+ theory as JSON string from the Formalizer agent. Call task(subagent_type='formalizer', prompt=<request>) first to obtain this."),
    },
    async execute(args, context) {
      if (!reasoningCoreClient.argue) {
        throw new Error("reasoning-core client does not support argue; cannot run deliberation pipeline")
      }

      const request = {
        id: args.id,
        timestamp: args.timestamp,
        problem_statement: args.problem_statement,
        options: args.options,
        constraints: args.constraints,
        preferences: args.preferences,
        ...(args.context !== undefined ? { context: args.context } : {}),
        requested_semantics: args.requested_semantics,
      }
      const kbContext = await queryContext(reasoningCoreClient, args.problem_statement)
      if (kbContext) {
        request.context = mergeDeliberationContext(request.context, kbContext)
      }

      const optionMap = createOptionMap(args.options)
      let theoryJson = args.theory
      let formalization: FormalizationBlock = buildFormalizationBlock()

      if (!theoryJson) {
        const formalizationService = resolveFormalizationService({
          override: deps?.formalizationService,
          delegateTaskTool: deps?.delegateTaskTool,
          context: context as ToolExecuteContext,
        })

        if (!formalizationService) {
          const response = failureResponse.buildNoTheoryResponse(request)
          const responseJson = JSON.stringify(response, null, 2)
          await writeDeliberationArtifact(workspaceRoot, args.id, responseJson)
          return responseJson
        }

        try {
          const result = await formalizationService.formalize({
            problem_statement: args.problem_statement,
            options: args.options,
            constraints: args.constraints,
            preferences: args.preferences,
            ...(request.context !== undefined ? { context: request.context } : {}),
            requested_semantics: args.requested_semantics,
          })
          theoryJson = JSON.stringify(result.theory)
          formalization = toFormalizationProvenanceBlock(result.provenance)
        } catch (err) {
          const errorCode: FormalizationErrorCode = err instanceof FormalizationError
            ? err.code
            : "provider_failure"
          const response = failureResponse.buildAutoFormalizationFailedResponse(request, err, errorCode)
          const responseJson = JSON.stringify(response, null, 2)
          await writeDeliberationArtifact(workspaceRoot, args.id, responseJson)
          return responseJson
        }
      }

      const parsedTheory = parseTheory(theoryJson, args.options, optionMap)
      if (!parsedTheory) {
        const response = failureResponse.buildInvalidTheoryResponse(request, new Error("Invalid theory JSON"))
        const responseJson = JSON.stringify(response, null, 2)
        await writeDeliberationArtifact(workspaceRoot, args.id, responseJson)
        return responseJson
      }
      const theory = parsedTheory
      const baseCallID = `submit-deliberation-${Date.now()}`
      const initialRound = await runRound({
        client: reasoningCoreClient,
        theory,
        requestedSemantics: args.requested_semantics,
        request,
        optionMap,
        sessionID: context.sessionID,
        callID: baseCallID,
      })
      const revisedRound = await applyAgmRevision({
        theory,
        round: initialRound,
        reRun: async (revisedTheory) => runRound({
          client: reasoningCoreClient,
          theory: revisedTheory,
          requestedSemantics: args.requested_semantics,
          request,
          optionMap,
          sessionID: context.sessionID,
          callID: `${baseCallID}:revision:${Date.now()}`,
        }),
      })
      const responseJson = buildSuccessResponseJson({
        response: revisedRound.response,
        preferenceCycle: initialRound.preferenceCycle,
        semanticsComparison: initialRound.semanticsComparison,
        ...(initialRound.audienceAnalysis ? { audienceAnalysis: initialRound.audienceAnalysis } : {}),
        ...(initialRound.epistemicAnalysis ? { epistemicAnalysis: initialRound.epistemicAnalysis } : {}),
        formalization,
        ...(initialRound.solveMetacognition ? { solveMetacognition: initialRound.solveMetacognition } : {}),
        ...(revisedRound.convergence ? { convergence: revisedRound.convergence } : {}),
      })

      await writeDeliberationArtifact(workspaceRoot, args.id, responseJson)
      await storePattern(reasoningCoreClient, request, revisedRound.response.verdict, theory as unknown as Record<string, unknown>)

      context.metadata?.({
        title: `Deliberation: ${revisedRound.response.verdict}`,
        metadata: {
          path: `.sisyphus/deliberations/${args.id.replace(/[^a-zA-Z0-9._-]/g, "_")}.md`,
          verdict: revisedRound.response.verdict,
        },
      })

      return responseJson
    },
  })
}

function parseTheory(
  theoryJson: string,
  options: string[],
  optionMap: Map<string, string>
): AgmRevisionTheory | null {
  try {
    const parsedTheory = JSON.parse(theoryJson)
    const theory = {
      premises: Array.isArray(parsedTheory?.premises) ? parsedTheory.premises : [],
      strict_rules: Array.isArray(parsedTheory?.strict_rules) ? parsedTheory.strict_rules : [],
      defeasible_rules: Array.isArray(parsedTheory?.defeasible_rules) ? parsedTheory.defeasible_rules : [],
      contrariness: Array.isArray(parsedTheory?.contraries) ? parsedTheory.contraries.map((pair: string[]) => ({ target: pair[0], attacker: pair[1], relation: "contrary" })) : [],
      preferences: Array.isArray(parsedTheory?.preferences) ? parsedTheory.preferences : [],
      classical_negation: parsedTheory?.classical_negation !== false,
    }
    for (const rule of theory.defeasible_rules) {
        const matchedOption = options.find((_, index) => rule.id.includes(String.fromCharCode(65 + index)) || rule.id.includes(String(index)))
        if (matchedOption && !optionMap.has(rule.consequent)) {
          optionMap.set(rule.consequent, matchedOption)
        }
      }
    return theory
  } catch {
    return null
  }
}

function resolveFormalizationService(input: {
  override?: SemanticFormalizationService
  delegateTaskTool?: DelegateTaskTool
  context: ToolExecuteContext
}): SemanticFormalizationService | null {
  if (input.override) return input.override
  if (!input.delegateTaskTool) return null
  return createDefaultSemanticService({
    delegateTaskTool: input.delegateTaskTool,
    pluginContext: {
      sessionID: input.context.sessionID,
      ...(input.context.metadata ? { metadata: input.context.metadata } : {}),
    },
  })
}
