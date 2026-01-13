import type { PluginInput } from "@opencode-ai/plugin"

export interface SisyphusTaskErrorPattern {
  pattern: string
  errorType: string
  fixHint: string
}

export const SISYPHUS_TASK_ERROR_PATTERNS: SisyphusTaskErrorPattern[] = [
  {
    pattern: "run_in_background",
    errorType: "missing_run_in_background",
    fixHint: "Add run_in_background=false (for delegation) or run_in_background=true (for parallel exploration)",
  },
  {
    pattern: "skills",
    errorType: "missing_skills",
    fixHint: "Add skills=[] parameter (empty array if no skills needed)",
  },
  {
    pattern: "category OR subagent_type",
    errorType: "mutual_exclusion",
    fixHint: "Provide ONLY one of: category (e.g., 'general', 'quick') OR subagent_type (e.g., 'oracle', 'explore')",
  },
  {
    pattern: "Must provide either category or subagent_type",
    errorType: "missing_category_or_agent",
    fixHint: "Add either category='general' OR subagent_type='explore'",
  },
  {
    pattern: "Unknown category",
    errorType: "unknown_category",
    fixHint: "Use a valid category from the Available list in the error message",
  },
  {
    pattern: "Agent name cannot be empty",
    errorType: "empty_agent",
    fixHint: "Provide a non-empty subagent_type value",
  },
  {
    pattern: "Unknown agent",
    errorType: "unknown_agent",
    fixHint: "Use a valid agent from the Available agents list in the error message",
  },
  {
    pattern: "Cannot call primary agent",
    errorType: "primary_agent",
    fixHint: "Primary agents cannot be called via sisyphus_task. Use a subagent like 'explore', 'oracle', or 'librarian'",
  },
  {
    pattern: "Skills not found",
    errorType: "unknown_skills",
    fixHint: "Use valid skill names from the Available list in the error message",
  },
]

export interface DetectedError {
  errorType: string
  originalOutput: string
}

export function detectSisyphusTaskError(output: string): DetectedError | null {
  if (!output.includes("❌")) return null

  for (const errorPattern of SISYPHUS_TASK_ERROR_PATTERNS) {
    if (output.includes(errorPattern.pattern)) {
      return {
        errorType: errorPattern.errorType,
        originalOutput: output,
      }
    }
  }

  return null
}

function extractAvailableList(output: string): string | null {
  const availableMatch = output.match(/Available[^:]*:\s*(.+)$/m)
  return availableMatch ? availableMatch[1].trim() : null
}

export function buildRetryGuidance(errorInfo: DetectedError): string {
  const pattern = SISYPHUS_TASK_ERROR_PATTERNS.find(
    (p) => p.errorType === errorInfo.errorType
  )

  if (!pattern) {
    return `[sisyphus_task ERROR] Fix the error and retry with correct parameters.`
  }

  let guidance = `
[sisyphus_task CALL FAILED - IMMEDIATE RETRY REQUIRED]

**Error Type**: ${errorInfo.errorType}
**Fix**: ${pattern.fixHint}
`

  const availableList = extractAvailableList(errorInfo.originalOutput)
  if (availableList) {
    guidance += `\n**Available Options**: ${availableList}\n`
  }

  guidance += `
**Action**: Retry sisyphus_task NOW with corrected parameters.

Example of CORRECT call:
\`\`\`
sisyphus_task(
  description="Task description",
  prompt="Detailed prompt...",
  category="general",  // OR subagent_type="explore"
  run_in_background=false,
  skills=[]
)
\`\`\`
`

  return guidance
}

export function createSisyphusTaskRetryHook(_ctx: PluginInput) {
  return {
    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { title: string; output: string; metadata: unknown }
    ) => {
      if (input.tool.toLowerCase() !== "sisyphus_task") return

      const errorInfo = detectSisyphusTaskError(output.output)
      if (errorInfo) {
        const guidance = buildRetryGuidance(errorInfo)
        output.output += `\n${guidance}`
      }
    },
  }
}
