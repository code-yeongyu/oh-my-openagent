import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { existsSync, readFileSync } from "node:fs"
import { getTranscriptPath } from "../../hooks/claude-code-hooks/transcript"
import { getChallenge } from "../../hooks/reasoning-core-policy-gate/epistemic-interlock-challenge-state"
import {
  createReasoningCoreClient,
  type ReasoningCoreClient,
  type ReasoningCoreSolveProblem,
} from "../../hooks/reasoning-core-policy-gate/reasoning-core-client"
import type { MultiPlaneHookConfig } from "../../hooks/epistemic-state-interpreter/hook-v2"
import { runEpistemicPipeline } from "./epistemic-pipeline"
import { injectStoredPreferences } from "./preference-pre-injection"
import type { ReasonArgueArgs, ReasonSolveArgs } from "./types"
import { log } from "../../shared/logger"

const ARGUMENT_SEMANTICS = ["grounded", "preferred", "stable", "complete"] as const

const argumentRuleSchema = tool.schema.object({
  id: tool.schema.string(),
  name: tool.schema.string().optional(),
  antecedents: tool.schema.array(tool.schema.string()),
  consequent: tool.schema.string(),
})

const argumentPreferenceSchema = tool.schema.object({
  superior: tool.schema.string(),
  inferior: tool.schema.string(),
})

const argumentTheorySchema = tool.schema.object({
  premises: tool.schema.array(
    tool.schema.object({
      formula: tool.schema.string(),
      kind: tool.schema.string().optional(),
    }),
  ),
  strict_rules: tool.schema.array(argumentRuleSchema).optional(),
  defeasible_rules: tool.schema.array(argumentRuleSchema).optional(),
  preferences: tool.schema.array(argumentPreferenceSchema).optional(),
  classical_negation: tool.schema.boolean().optional(),
})

const reasonSolveTheorySchema = tool.schema.object({}).catchall(tool.schema.unknown())

function formatToolResult(result: unknown): string {
  return typeof result === "string" ? result : JSON.stringify(result, null, 2)
}

function formatReasoningResponse(result: unknown, sidecar: ReturnType<typeof runEpistemicPipeline>): string {
  return sidecar === null ? formatToolResult(result) : JSON.stringify({ core: result, deliberative: sidecar }, null, 2)
}

function annotateTitle(context: { metadata?: (input: { title?: string }) => void }, title: string): void { context.metadata?.({ title }) }

function toReasonSolveProblem(args: ReasonSolveArgs): ReasoningCoreSolveProblem {
  return {
    description: args.description,
    variables: args.variables,
    theory: args.theory as ReasoningCoreSolveProblem["theory"],
    max_iterations: args.max_iterations,
    initial_constraints: (args.initial_constraints ?? []) as ReasoningCoreSolveProblem["initial_constraints"],
    incremental_constraints: args.incremental_constraints as ReasoningCoreSolveProblem["incremental_constraints"],
  }
}

function runPipelineSafely(
  result: unknown,
  context: { sessionID: string },
  callID: string,
  config?: MultiPlaneHookConfig,
): ReturnType<typeof runEpistemicPipeline> {
  if (!config?.enabled) return null
  try { return runEpistemicPipeline(result, context.sessionID, callID, config) } catch { return null }
}

function injectStoredPreferencesSafely(sessionID: string, theory: Record<string, unknown>): void {
  try { injectStoredPreferences(sessionID, theory) } catch {}
}

function getAcceptedConclusions(result: unknown): string[] {
  if (typeof result !== "object" || result === null || !("result" in result)) return []
  const extensions = (result as { result?: { extensions?: Array<{ accepted_conclusions?: unknown[] }> } }).result?.extensions
  return (extensions ?? []).flatMap(extension => (extension.accepted_conclusions ?? []).filter((conclusion): conclusion is string => typeof conclusion === "string"))
}

function getActiveChallengeFilePath(sessionID: string): string | undefined {
  const transcriptPath = getTranscriptPath(sessionID)
  if (!existsSync(transcriptPath)) return undefined
  const lines = readFileSync(transcriptPath, "utf8").trim().split("\n")
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const entry = JSON.parse(lines[index] ?? "{}") as { tool_name?: string; tool_input?: { file_path?: unknown } }
      const toolName = entry.tool_name?.toLowerCase()
      const filePath = typeof entry.tool_input?.file_path === "string" ? entry.tool_input.file_path : undefined
      if ((toolName === "write" || toolName === "edit") && filePath && getChallenge(sessionID, filePath)) return filePath
    } catch { continue }
  }
  return undefined
}

async function persistCounterArgumentProofIfNeeded(client: ReasoningCoreClient, sessionID: string, result: unknown): Promise<void> {
  const acceptedConclusions = getAcceptedConclusions(result)
  const hasCounterArgument = acceptedConclusions.some(conclusion => conclusion === "allow_action(current)" || conclusion.startsWith("mutation_authorized") || conclusion.startsWith("no_architectural_violation") || conclusion.startsWith("write_authorized_by_prometheus_protocol"))
  const filePath = hasCounterArgument ? getActiveChallengeFilePath(sessionID) : undefined
  if (!client.kbAdd || !filePath) return
  try {
    await client.kbAdd({
      layer: "Learned",
      tags: ["counter-argument", "reason-argue", `file:${filePath}`],
      content: {
        Insight: {
          problem_type: "epistemic_interlock_counter_argument",
          lesson: `counter-argument proof ${filePath}`,
          example: acceptedConclusions[0] ?? "allow_action(current)",
        },
      },
    })
  } catch (error) {
    log("[reasoning-core] counter-argument persistence failed - continuing", { sessionID, filePath, error: String(error) })
  }
}

export function createReasonArgueTool(config?: MultiPlaneHookConfig): ToolDefinition {
  return createReasonArgueToolWithDeps(config)
}

export function createReasonArgueToolWithDeps(
  config?: MultiPlaneHookConfig,
  deps?: { client?: ReasoningCoreClient },
): ToolDefinition {
  const reasoningCoreClient = deps?.client ?? createReasoningCoreClient()
  return tool({
    description:
      "ASPIC+ structured argumentation with proof chains. Wraps reasoning-core MCP for epistemic pipeline integration.",
    args: {
      theory: argumentTheorySchema.describe("ASPIC+ theory with premises, rules, and preferences"),
      semantics: tool.schema.enum(ARGUMENT_SEMANTICS).optional().describe("ASPIC+ semantics to use"),
    },
    async execute(args: ReasonArgueArgs, context) {
      if (!reasoningCoreClient.argue) {
        throw new Error("reasoning-core client does not support reason_argue")
      }

      annotateTitle(context, "ASPIC+ Argumentation Result")
      injectStoredPreferencesSafely(context.sessionID, args.theory as Record<string, unknown>)
      const result = await reasoningCoreClient.argue(args)
      await persistCounterArgumentProofIfNeeded(reasoningCoreClient, context.sessionID, result)
      const callID = `reason-argue-${Date.now()}`
      const sidecar = runPipelineSafely(result, context, callID, config)
      return formatReasoningResponse(result, sidecar)
    },
  })
}

export function createReasonSolveTool(config?: MultiPlaneHookConfig): ToolDefinition {
  return createReasonSolveToolWithDeps(config)
}

export function createReasonSolveToolWithDeps(
  config?: MultiPlaneHookConfig,
  deps?: { client?: ReasoningCoreClient },
): ToolDefinition {
  const reasoningCoreClient = deps?.client ?? createReasoningCoreClient()
  return tool({
    description:
      "Constraint-guided reasoning and argumentation solving. Wraps reasoning-core MCP for epistemic pipeline integration.",
    args: {
      description: tool.schema.string().describe("Natural language problem description"),
      variables: tool.schema.array(
        tool.schema.object({
          name: tool.schema.string(),
          domain: tool.schema.array(tool.schema.number()),
        }),
      ).describe("Variables and their candidate domains"),
      theory: reasonSolveTheorySchema.describe("Theory payload forwarded to reasoning-core"),
      max_iterations: tool.schema.number().describe("Maximum reasoning iterations"),
      initial_constraints: tool.schema.array(tool.schema.unknown()).optional().describe("Initial constraints to seed the solver"),
      incremental_constraints: tool.schema.array(tool.schema.unknown()).optional().describe("Additional constraints applied during solving"),
    },
    async execute(args: ReasonSolveArgs, context) {
      annotateTitle(context, "Constraint Reasoning Result")
      injectStoredPreferencesSafely(context.sessionID, args.theory)
      const result = await reasoningCoreClient.solve(toReasonSolveProblem(args))
      const callID = `reason-solve-${Date.now()}`
      const sidecar = runPipelineSafely(result, context, callID, config)
      return formatReasoningResponse(result, sidecar)
    },
  })
}
