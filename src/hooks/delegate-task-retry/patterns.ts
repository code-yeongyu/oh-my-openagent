export interface DelegateTaskErrorPattern {
  pattern: string
  errorType: string
  fixHint: string
}

export const DELEGATE_TASK_ERROR_PATTERNS: DelegateTaskErrorPattern[] = [
  // NOTE: When adding new "Invalid arguments:" errors to tools.ts, add a matching pattern here.
  {
    pattern: "'run_in_background' parameter is REQUIRED",
    errorType: "missing_run_in_background",
    fixHint:
      "Add run_in_background=false (for delegation) or run_in_background=true (for parallel exploration)",
  },
  {
    pattern: "load_skills=null is not allowed",
    errorType: "invalid_load_skills_null",
    fixHint: "Use load_skills=[] (empty array) when no skills are needed, not null.",
  },
  {
    pattern: "'load_skills' parameter is REQUIRED",
    errorType: "missing_load_skills",
    fixHint:
      "Add load_skills=[] parameter (empty array if no skills needed). Note: Calling Skill tool does NOT populate this.",
  },
  {
    pattern: "Must provide either category or subagent_type",
    errorType: "missing_category_or_agent",
    fixHint: "Add either category='general' OR subagent_type='explore'",
  },
  {
    pattern: 'Unknown category: "',
    errorType: "unknown_category",
    fixHint: "Use a valid category from the Available list in the error message",
  },
  {
    pattern: "Agent name cannot be empty.",
    errorType: "empty_agent",
    fixHint: "Provide a non-empty subagent_type value",
  },
  {
    pattern: 'Unknown agent: "',
    errorType: "unknown_agent",
    fixHint: "Use a valid agent from the Available agents list in the error message",
  },
  {
    pattern: 'Cannot call primary agent "',
    errorType: "primary_agent",
    fixHint:
      "Primary agents cannot be called via task. Use a subagent like 'explore', 'oracle', or 'librarian'",
  },
  {
    pattern: "Skills not found: ",
    errorType: "unknown_skills",
    fixHint: "Use valid skill names from the Available list in the error message",
  },
]

export interface DetectedError {
  errorType: string
  originalOutput: string
}

export function detectDelegateTaskError(output: string): DetectedError | null {
  // Pattern-first: scan for known error patterns regardless of prefix.
  // Patterns are structurally anchored to actual error message formats
  // (e.g., 'Unknown agent: "' not just 'Unknown agent') to prevent
  // false positives on successful task outputs discussing errors.
  for (const errorPattern of DELEGATE_TASK_ERROR_PATTERNS) {
    if (output.includes(errorPattern.pattern)) {
      return {
        errorType: errorPattern.errorType,
        originalOutput: output,
      }
    }
  }

  // Fallback: if no known pattern matched but output starts with [ERROR],
  // return unknown_delegate_task_error for retry eligibility
  if (output.startsWith("[ERROR]")) {
    return {
      errorType: "unknown_delegate_task_error",
      originalOutput: output,
    }
  }

  return null
}
