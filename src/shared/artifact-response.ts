/**
 * Artifact Response Types (LIF-69)
 *
 * Defines the structured envelope format for specialist agent outputs.
 * Enables cost optimization by returning summaries instead of full content.
 *
 * @see .cursor/specs/LIF-69-feat-omo-delegation-optimization/plan.md
 */

/* --- Core Types --- */

export type ArtifactStatus = "success" | "partial" | "error"

export interface ArtifactPointer {
  /** Repo-relative path to the artifact */
  path: string
  /** Type of artifact */
  kind: "file" | "diff" | "log" | "report" | "link"
  /** Short description of the artifact */
  description: string
}

export interface ArtifactTelemetry {
  /** Trace ID for correlation across hooks/tools */
  traceId: string
  /** Session ID */
  sessionId: string
  /** Source agent name */
  fromAgent?: string
  /** Target agent name */
  toAgent?: string
  /** Model used for execution */
  model?: string
  /** Input character count (cheap proxy for tokens) */
  inputChars?: number
  /** Output character count (cheap proxy for tokens) */
  outputChars?: number
  /** Whether the response was truncated */
  truncated?: boolean
}

export interface ArtifactResponse {
  /** Schema version for forward compatibility */
  schemaVersion: "1.0"
  /** Execution status */
  status: ArtifactStatus
  /** Summary of the work done (≤200 tokens, enforced) */
  summary: string
  /** List of files changed (repo-relative paths) */
  filesChanged: string[]
  /** Warnings encountered during execution */
  warnings: string[]
  /** Suggested next steps */
  nextSteps: string[]
  /** Artifact pointers (no large inline content) */
  artifacts: ArtifactPointer[]
  /** Telemetry data for cost tracking */
  telemetry: ArtifactTelemetry
}

/* --- Configuration Types --- */

export interface ArtifactTruncationConfig {
  /** Maximum tokens estimate for summary (default: 200) */
  maxSummaryTokenEstimate: number
  /** Hard cap on total output characters */
  maxOutputChars: number
  /** Whether to preserve <task_metadata> block */
  keepTaskMetadata: boolean
}

/** Default truncation configuration */
export const DEFAULT_ARTIFACT_TRUNCATION_CONFIG: ArtifactTruncationConfig = {
  maxSummaryTokenEstimate: 200,
  maxOutputChars: 4000, // ~1000 tokens
  keepTaskMetadata: true,
}

/* --- Utility Functions --- */

/**
 * Estimate token count from character count.
 * Uses chars/4 heuristic as a cheap approximation.
 */
export function estimateTokens(chars: number): number {
  return Math.ceil(chars / 4)
}

/**
 * Estimate character count from token count.
 */
export function estimateChars(tokens: number): number {
  return tokens * 4
}

/**
 * Extract task metadata block from response text.
 * Returns the metadata block and the remaining text.
 */
export function extractTaskMetadata(text: string): {
  metadata: string | null
  content: string
} {
  const metadataRegex = /<task_metadata>([\s\S]*?)<\/task_metadata>/
  const match = text.match(metadataRegex)

  if (match) {
    return {
      metadata: match[0],
      content: text.replace(metadataRegex, "").trim(),
    }
  }

  return {
    metadata: null,
    content: text,
  }
}

/**
 * Coerce raw response text into a structured ArtifactResponse.
 * Wraps unstructured text into the envelope format.
 */
export function coerceToArtifactResponse(
  rawText: string,
  base: {
    sessionId: string
    traceId?: string
    fromAgent?: string
    toAgent?: string
    model?: string
    filesChanged?: string[]
    status?: ArtifactStatus
  }
): ArtifactResponse {
  const { content } = extractTaskMetadata(rawText)

  // Try to parse as JSON first (if agent returned structured response)
  try {
    const parsed = JSON.parse(content)
    if (parsed.schemaVersion === "1.0" && parsed.summary) {
      return {
        ...parsed,
        telemetry: {
          ...parsed.telemetry,
          sessionId: base.sessionId,
          traceId: base.traceId ?? parsed.telemetry?.traceId ?? generateTraceId(),
          fromAgent: base.fromAgent,
          toAgent: base.toAgent,
          model: base.model,
          inputChars: rawText.length,
          outputChars: content.length,
        },
      }
    }
  } catch {
    // Not JSON, proceed with text coercion
  }

  // Extract file paths mentioned in the content
  const filePathRegex = /(?:src|tests|docs|lib|packages)\/[\w\-./]+\.\w+/g
  const mentionedFiles = content.match(filePathRegex) ?? []

  return {
    schemaVersion: "1.0",
    status: base.status ?? "success",
    summary: content.slice(0, estimateChars(200)),
    filesChanged: base.filesChanged ?? [...new Set(mentionedFiles)],
    warnings: [],
    nextSteps: [],
    artifacts: [],
    telemetry: {
      traceId: base.traceId ?? generateTraceId(),
      sessionId: base.sessionId,
      fromAgent: base.fromAgent,
      toAgent: base.toAgent,
      model: base.model,
      inputChars: rawText.length,
      outputChars: content.length,
      truncated: false,
    },
  }
}

/**
 * Truncate an ArtifactResponse to fit within configured limits.
 * Enforces the ≤200 token summary constraint.
 */
export function truncateArtifactResponse(
  response: ArtifactResponse,
  config: ArtifactTruncationConfig = DEFAULT_ARTIFACT_TRUNCATION_CONFIG
): ArtifactResponse {
  const maxSummaryChars = estimateChars(config.maxSummaryTokenEstimate)
  let truncated = false

  // Truncate summary if needed
  let summary = response.summary
  if (summary.length > maxSummaryChars) {
    summary = summary.slice(0, maxSummaryChars - 3) + "..."
    truncated = true
  }

  // Truncate warnings and nextSteps if too many
  const maxItems = 5
  const warnings = response.warnings.slice(0, maxItems)
  const nextSteps = response.nextSteps.slice(0, maxItems)

  // Truncate artifacts list
  const artifacts = response.artifacts.slice(0, 10)

  return {
    ...response,
    summary,
    warnings,
    nextSteps,
    artifacts,
    telemetry: {
      ...response.telemetry,
      truncated: truncated || response.telemetry.truncated,
    },
  }
}

/**
 * Format an ArtifactResponse for return to the parent agent.
 * Produces a human-readable summary with optional task metadata.
 */
export function formatArtifactResponseForReturn(
  response: ArtifactResponse,
  options: {
    includeTaskMetadata: boolean
    sessionId: string
  }
): string {
  const parts: string[] = []

  // Status and summary
  parts.push(`**Status**: ${response.status}`)
  parts.push("")
  parts.push(`**Summary**: ${response.summary}`)

  // Files changed
  if (response.filesChanged.length > 0) {
    parts.push("")
    parts.push("**Files Changed**:")
    response.filesChanged.forEach((f) => parts.push(`- ${f}`))
  }

  // Warnings
  if (response.warnings.length > 0) {
    parts.push("")
    parts.push("**Warnings**:")
    response.warnings.forEach((w) => parts.push(`- ${w}`))
  }

  // Next steps
  if (response.nextSteps.length > 0) {
    parts.push("")
    parts.push("**Next Steps**:")
    response.nextSteps.forEach((s) => parts.push(`- ${s}`))
  }

  // Artifacts
  if (response.artifacts.length > 0) {
    parts.push("")
    parts.push("**Artifacts**:")
    response.artifacts.forEach((a) => parts.push(`- [${a.kind}] ${a.path}: ${a.description}`))
  }

  // Telemetry (truncation indicator)
  if (response.telemetry.truncated) {
    parts.push("")
    parts.push("*Note: Response was truncated for cost optimization.*")
  }

  let result = parts.join("\n")

  // Add task metadata if requested
  if (options.includeTaskMetadata) {
    result += `\n\n<task_metadata>\nsession_id: ${options.sessionId}\n</task_metadata>`
  }

  return result
}

/**
 * Generate a simple trace ID for correlation.
 */
function generateTraceId(): string {
  return `tr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}
