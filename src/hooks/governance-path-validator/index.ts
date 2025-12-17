import type { PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared"
import {
  type PathValidatorConfig,
  type PathValidationResult,
  DEFAULT_PATH_VALIDATOR_CONFIG,
} from "./types"

export * from "./types"

/**
 * Validates a file path against allowed paths.
 * @param filePath - The file path to validate (relative or absolute)
 * @param allowedPaths - List of allowed path prefixes
 * @param projectRoot - The project root directory
 * @returns Validation result
 */
function validatePath(
  filePath: string,
  allowedPaths: string[],
  projectRoot: string
): PathValidationResult {
  // Normalize the path to be relative to project root
  let relativePath = filePath
  if (filePath.startsWith(projectRoot)) {
    relativePath = filePath.slice(projectRoot.length)
    if (relativePath.startsWith("/")) {
      relativePath = relativePath.slice(1)
    }
  }

  // Check if path starts with any allowed prefix
  for (const allowedPath of allowedPaths) {
    if (relativePath.startsWith(allowedPath)) {
      return { valid: true, path: relativePath }
    }
  }

  // Check for common misplacements and suggest corrections
  let suggestion: string | undefined

  // If writing to root level, suggest appropriate location
  if (!relativePath.includes("/")) {
    suggestion = `Consider placing in src/, docs/, or context/specs/`
  }

  // If writing spec-like content outside context/specs
  if (
    relativePath.includes("spec") ||
    relativePath.includes("plan") ||
    relativePath.includes("task")
  ) {
    if (!relativePath.startsWith("context/specs/") && !relativePath.startsWith(".cursor/specs/")) {
      suggestion = `Spec files should go in context/specs/ or .cursor/specs/`
    }
  }

  return {
    valid: false,
    path: relativePath,
    reason: `Path "${relativePath}" is not in allowed locations: ${allowedPaths.join(", ")}`,
    suggestion,
  }
}

/**
 * Creates the governance path validator hook.
 * This hook intercepts write and edit tool calls to validate file paths.
 *
 * @param ctx - Plugin context
 * @param config - Optional configuration override
 * @returns Hook handlers
 */
export function createGovernancePathValidatorHook(
  ctx: PluginInput,
  config?: Partial<PathValidatorConfig>
) {
  const finalConfig: PathValidatorConfig = {
    ...DEFAULT_PATH_VALIDATOR_CONFIG,
    ...config,
  }

  if (!finalConfig.enabled || finalConfig.mode === "disabled") {
    log("Governance path validator disabled")
    return null
  }

  log("Governance path validator initialized", {
    mode: finalConfig.mode,
    allowedPaths: finalConfig.allowed_paths,
  })

  return {
    "tool.execute.before": async (
      input: {
        tool: string
        sessionID: string
        args: Record<string, unknown>
      },
      output: {
        args: Record<string, unknown>
        metadata?: Record<string, unknown>
      }
    ): Promise<void> => {
      // Only validate write and edit tools
      if (!["write", "edit"].includes(input.tool)) {
        return
      }

      // Extract file path from args
      const filePath = (output.args.filePath || output.args.path) as string | undefined
      if (!filePath) {
        return
      }

      const result = validatePath(
        filePath,
        finalConfig.allowed_paths,
        ctx.directory
      )

      if (!result.valid) {
        const message = [
          `⚠️ [Governance] Path validation ${finalConfig.mode === "block" ? "BLOCKED" : "WARNING"}`,
          `Tool: ${input.tool}`,
          `Path: ${result.path}`,
          `Reason: ${result.reason}`,
          result.suggestion ? `Suggestion: ${result.suggestion}` : null,
        ]
          .filter(Boolean)
          .join("\n")

        log(message)

        if (finalConfig.mode === "block") {
          // Add metadata to indicate blocked operation
          output.metadata = {
            ...output.metadata,
            governance_blocked: true,
            governance_reason: result.reason,
            governance_suggestion: result.suggestion,
          }

          // Modify the output to prevent the operation
          // Note: This depends on how OpenCode handles tool.execute.before output
          // If it supports cancellation, we would use that mechanism here
          throw new Error(
            `[Governance] Operation blocked: ${result.reason}${
              result.suggestion ? `\nSuggestion: ${result.suggestion}` : ""
            }`
          )
        }

        // In warn mode, add metadata but allow operation to proceed
        output.metadata = {
          ...output.metadata,
          governance_warning: true,
          governance_reason: result.reason,
          governance_suggestion: result.suggestion,
        }
      }
    },
  }
}
