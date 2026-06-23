import { resolve } from "node:path"
import { log } from "../../shared"
import type { SidecarInput, SidecarOutput } from "../consequence-lifting-sidecar/types"
import { runConsequenceLiftingSidecar } from "../consequence-lifting-sidecar/sidecar"
import { normalizeProofArtifact } from "../epistemic-state-interpreter/normalize-proof-artifact"
import { computePianoD } from "../epistemic-state-interpreter/piano-d-engine"
import { parseProofArtifact } from "../epistemic-state-interpreter/proof-artifact-parser"
import { processConclusion } from "../epistemic-state-interpreter/hook-v2-conclusion-processor"
import type { MultiPlaneHookConfig } from "../epistemic-state-interpreter/hook-v2"
import type { ReasonArgueRequest, ReasoningCoreClient } from "./reasoning-core-client"
import type { ReasoningCorePolicyGateHook } from "./types"
import { buildDeliberationResponse } from "./deliberation-response-builder"
import {
  buildFormalizationFailedResponse,
  createOptionMap,
  getDeliberationFormalizationService,
  parseDeliberationRequest,
  toFormalizationRequest,
} from "./deliberation-gate-formalization"
import {
  FormalizationError,
  type SemanticFormalizationService,
} from "./semantic-formalization-service"

const PIPELINE_CONFIG: MultiPlaneHookConfig = {
  enabled: true,
  epistemic_gate_mode: "annotation",
  plausibilita_threshold: 0.6,
  ethical_value_hierarchy: ["vita_umana", "autonomia"],
  pragmatic_weights: { peso_proprio: 0.6, peso_controparte: 0.4 },
  moral_context_defaults: { default_audience: "general", require_audience_model: false },
  transition_thresholds: { advancement_min_strength: 1, retrocession_min_strength: 2, expulsion_min_strength: 3, reopening_min_strength: 2 },
  confidence_weights: { extensionRatio: 0.4, proofChainDepth: 0.3, ruleStrength: 0.3 },
}

export function createDeliberationGateHook(input: {
  client: ReasoningCoreClient
  workspaceRoot?: string
  runConsequenceLiftingSidecarFn?: (input: SidecarInput) => SidecarOutput
  formalizationService?: SemanticFormalizationService
}): ReasoningCorePolicyGateHook {
  const workspaceRoot = input.workspaceRoot ?? process.cwd()
  const runSidecar = input.runConsequenceLiftingSidecarFn ?? runConsequenceLiftingSidecar
  const formalizationService = getDeliberationFormalizationService(input.formalizationService)

  return {
    "tool.execute.before": async ({ tool, sessionID, callID }, output): Promise<void> => {
      if (!isDeliberationCandidate(tool, output.args)) return

      const filePath = extractFilePath(output.args)
      const content = await resolvePendingContent(output.args, workspaceRoot)
      const request = parseDeliberationRequest(content)
      const optionMap = createOptionMap(request.options)
      let formalization

      try {
        formalization = await formalizationService.formalize(toFormalizationRequest(request), {
          expectedOptionAtoms: [...optionMap.keys()],
        })
      } catch (error) {
        if (error instanceof FormalizationError) {
          output.args.content = JSON.stringify(buildFormalizationFailedResponse(request, error), null, 2)
          return
        }

        throw error
      }

      const normalizedTheory = toReasonArgueTheory(formalization.theory)
      if (!normalizedTheory) {
        throw new Error("formalization service returned an invalid theory")
      }
      const theory = { semantics: request.requested_semantics, theory: normalizedTheory }
      const argueResult = await input.client.argue?.(theory)
      const proofArtifact = normalizeProofArtifact(argueResult)
      const parsed = parseProofArtifact(proofArtifact)
      let sidecarResult: SidecarOutput | null = null
      let sidecarError: unknown = undefined

      if (parsed !== null) {
        try {
          sidecarResult = runSidecar({
            processed: createProcessedConclusions(proofArtifact, sessionID, callID, parsed),
            proofArtifact,
            sessionID,
            callID,
          })
        } catch (error) {
          sidecarError = error
          log("[deliberation-gate] sidecar failed", { sessionID, callID, filePath, error: String(error) })
        }
      }

      const response = buildDeliberationResponse({ request, theory, argueResult, optionMap, sidecarResult, sidecarError })
      const { derived_theory: _ignoredDerivedTheory, ...formalizationProvenance } = formalization.provenance
      // @ts-ignore - dynamic extension of response schema
      response.formalization = { ...formalizationProvenance, derived_theory: formalization.theory }
      // @ts-ignore - dynamic extension of provenance schema
      response.provenance = { ...response.provenance, formalization: { ...formalizationProvenance, derived_theory: formalization.theory } }
      output.args.content = JSON.stringify(response, null, 2)
    },

    "tool.execute.after": async ({ tool, sessionID }, output): Promise<void> => {
      // Validate the written file parses as a valid DeliberationResponse.
      // If the before-phase replaced the content, the file should now be a well-formed response.
      if (!["write", "edit"].includes(tool.toLowerCase())) return
      if (typeof output.output !== "string") return
      // Validate JSON structure: must have verdict field
      try {
        const parsed = JSON.parse(output.output)
        if (parsed && typeof parsed.verdict === "undefined" && typeof parsed.problem_statement === "string") {
          // File still looks like a request (gate did not process it) - log but do not throw
          log("[deliberation-gate] after-phase: file appears to be a request, not a response", { sessionID })
        }
      } catch {
        // Not JSON (may be YAML or non-deliberation file) - skip validation
      }
    },
  }
}

function isDeliberationCandidate(tool: string, args: Record<string, unknown>): boolean {
  if (!["write", "edit"].includes(tool.toLowerCase())) return false
  const filePath = extractFilePath(args)
  return /(^|[/\\])\.sisyphus[/\\]deliberations[/\\].+\.md$/i.test(filePath)
}

function extractFilePath(args: Record<string, unknown>): string {
  const value = args.filePath ?? args.path ?? args.file ?? args.file_path
  return typeof value === "string" ? value : ""
}

async function resolvePendingContent(args: Record<string, unknown>, workspaceRoot: string): Promise<string> {
  if (typeof args.content === "string") return args.content

  const filePath = extractFilePath(args)
  const absolutePath = resolve(workspaceRoot, filePath)
  const existing = await Bun.file(absolutePath).text().catch(() => "")

  if (typeof args.oldString === "string" && typeof args.newString === "string") {
    if (!args.oldString) return args.newString
    return existing.replace(args.oldString, args.newString)
  }

  if (Array.isArray(args.edits)) {
    return args.edits.reduce((nextContent, edit) => {
      if (!isRecord(edit) || typeof edit.oldText !== "string" || typeof edit.newText !== "string") return nextContent
      return nextContent.replace(edit.oldText, edit.newText)
    }, existing)
  }

  throw new Error("Deliberation gate requires write/edit content to reconstruct the pending request.")
}

function createProcessedConclusions(
  response: unknown,
  sessionID: string,
  callID: string,
  parsed: NonNullable<ReturnType<typeof parseProofArtifact>>,
) {
  const timestamp = Date.now()
  const processed = [...parsed.conclusions.entries()].map(([conclusion, parsedConclusion]) => processConclusion({
    config: PIPELINE_CONFIG,
    response,
    sessionID,
    callID,
    conclusion,
    parsedConclusion,
    extensionCount: parsed.extensionCount,
    totalConclusions: parsed.conclusions.size,
    timestamp,
  }))
  const pianoD = computePianoD({ conclusions: processed.map(({ annotation, valutazione, blocked }) => ({ conclusion: annotation.conclusion, valutazione, blocked })) })

  for (const { annotation } of processed) {
    annotation.state.pianoD = pianoD
  }

  return processed
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function toReasonArgueTheory(theory: unknown): ReasonArgueRequest["theory"] | undefined {
  if (!isRecord(theory) || !Array.isArray(theory.premises)) return undefined

  return {
    premises: theory.premises as Array<{ formula: string; kind?: string }>,
    strict_rules: Array.isArray(theory.strict_rules) ? theory.strict_rules as Array<{ id: string; antecedents: string[]; consequent: string }> : [],
    defeasible_rules: Array.isArray(theory.defeasible_rules)
      ? theory.defeasible_rules as Array<{ id: string; name?: string; antecedents: string[]; consequent: string }>
      : [],
    contrariness: Array.isArray(theory.contraries)
      ? (theory.contraries as Array<[string, string]>).map(pair => ({ target: pair[0], attacker: pair[1], relation: "contrary" }))
      : [],
    preferences: (function () {
      if (Array.isArray(theory.preferences)) {
        return theory.preferences as Array<{ superior: string; inferior: string }>
      }
      if (isRecord(theory.preferences)) {
        const flat: { superior: string; inferior: string }[] = []
        if (Array.isArray(theory.preferences.pairwise)) {
          flat.push(...theory.preferences.pairwise)
        }
        if (Array.isArray(theory.preferences.groups)) {
          for (const group of theory.preferences.groups) {
            if (Array.isArray(group.ordered_rules)) {
              for (let i = 0; i < group.ordered_rules.length - 1; i++) {
                flat.push({ superior: group.ordered_rules[i], inferior: group.ordered_rules[i + 1] })
              }
            }
          }
        }
        return flat
      }
      return []
    })(),
    classical_negation: theory.classical_negation !== false,
  }
}
