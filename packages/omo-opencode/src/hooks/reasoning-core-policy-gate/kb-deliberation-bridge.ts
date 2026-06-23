import type { ReasoningCoreClient } from "./reasoning-core-client"
import { log } from "../../shared/logger"

const DELIBERATION_KB_TAG = "themis-deliberation"
const MAX_CONTEXT_ENTRIES = 3

type DeliberationPatternRequest = {
  problem_statement: string
  options: string[]
  constraints: string[]
  requested_semantics: "grounded" | "preferred" | "stable" | "complete"
}

export async function queryContext(client: ReasoningCoreClient, problemStatement: string): Promise<string> {
  try {
    const result = await client.kbQuery({
      content_type: "insight",
      keyword: "themis_deliberation",
      layer: "Learned",
      similarity_query: problemStatement,
      tags: [DELIBERATION_KB_TAG, "reasoning"],
    })
    const lines = result.entries
      .map(formatInsightLine)
      .filter((line): line is string => line.length > 0)
      .slice(0, MAX_CONTEXT_ENTRIES)

    if (lines.length === 0) return ""
    return ["Relevant KB context from prior deliberations:", ...lines].join("\n")
  } catch (error) {
    log("[kb-deliberation-bridge] kb-query-failed (non-blocking)", {
      severity: "warning",
      failure_kind: "kb_query",
      problemStatement,
      error: error instanceof Error ? error.message : String(error),
    })
    return ""
  }
}

export async function storePattern(
  client: ReasoningCoreClient,
  request: DeliberationPatternRequest,
  verdict: string,
  theory: Record<string, unknown>,
): Promise<void> {
  try {
    await client.kbAdd({
      layer: "Learned",
      content: {
        Insight: {
          problem_type: "themis_deliberation",
          lesson: `Deliberation for "${request.problem_statement}" resolved with verdict=${verdict} under ${request.requested_semantics} semantics.`,
          example: `options=[${request.options.join(" | ")}]; constraints=[${request.constraints.join(" | ") || "none"}]; theory=${summarizeTheory(theory)}`,
        },
      },
      tags: [DELIBERATION_KB_TAG, "reasoning", `semantics:${request.requested_semantics}`, `verdict:${verdict}`],
    })
  } catch (error) {
    log("[kb-deliberation-bridge] kb-add-failed (non-blocking)", {
      severity: "warning",
      failure_kind: "kb_add",
      problemStatement: request.problem_statement,
      verdict,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

function formatInsightLine(entry: Record<string, unknown>): string {
  const content = isRecord(entry.content) ? entry.content : undefined
  const insight = content && isRecord(content.Insight) ? content.Insight : undefined
  const lesson = typeof insight?.lesson === "string" ? insight.lesson.trim() : ""
  const example = typeof insight?.example === "string" ? insight.example.trim() : ""
  if (!lesson && !example) return ""
  return example ? `- ${lesson} Example: ${example}` : `- ${lesson}`
}

function summarizeTheory(theory: Record<string, unknown>): string {
  const count = (key: string) => Array.isArray(theory[key]) ? theory[key].length : 0
  return `premises:${count("premises")}, strict_rules:${count("strict_rules")}, defeasible_rules:${count("defeasible_rules")}, preferences:${count("preferences")}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
