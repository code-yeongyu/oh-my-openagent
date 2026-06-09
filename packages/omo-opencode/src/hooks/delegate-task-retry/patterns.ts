export interface DelegateTaskErrorPattern {
  pattern: string
  errorType: string
  fixHint: string
}

export const DELEGATE_TASK_ERROR_PATTERNS: DelegateTaskErrorPattern[] = [
  {
    pattern: "run_in_background",
    errorType: "missing_run_in_background",
    fixHint:
      "Add run_in_background=false (for delegation) or run_in_background=true (for parallel exploration)",
  },
  {
    pattern: "load_skills",
    errorType: "missing_load_skills",
    fixHint:
      "Add load_skills=[] parameter (empty array if no skills needed). Note: Calling Skill tool does NOT populate this.",
  },
  {
    pattern: "category OR subagent_type",
    errorType: "mutual_exclusion",
    fixHint:
      "Provide ONLY one of: category (e.g., 'general', 'quick') OR subagent_type (e.g., 'oracle', 'explore')",
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
    fixHint:
      "Primary agents cannot be called via task. Use a subagent like 'explore', 'oracle', or 'librarian'",
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

export function detectDelegateTaskError(output: string): DetectedError | null {
  if (!output.includes("[ERROR]") && !output.includes("Invalid arguments")) return null

  for (const errorPattern of DELEGATE_TASK_ERROR_PATTERNS) {
    if (output.includes(errorPattern.pattern)) {
      return {
        errorType: errorPattern.errorType,
        originalOutput: output,
      }
    }
  }

  return null
}
