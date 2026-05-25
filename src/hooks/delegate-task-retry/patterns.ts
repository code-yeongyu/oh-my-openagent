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
      "添加 run_in_background=false（用于委派）或 run_in_background=true（用于并行探索）",
  },
  {
    pattern: "load_skills",
    errorType: "missing_load_skills",
    fixHint:
      "添加 load_skills=[] 参数（如果不需要技能则为空数组）。注意：调用 Skill 工具并不会填充此参数。",
  },
  {
    pattern: "category OR subagent_type",
    errorType: "mutual_exclusion",
    fixHint:
      "仅提供其中之一：category（例如 'general'、'quick'）或 subagent_type（例如 'oracle'、'explore'）",
  },
  {
    pattern: "Must provide either category or subagent_type",
    errorType: "missing_category_or_agent",
    fixHint: "添加 category='general' 或 subagent_type='explore'",
  },
  {
    pattern: "Unknown category",
    errorType: "unknown_category",
    fixHint: "使用错误消息中可用列表中的有效分类",
  },
  {
    pattern: "Agent name cannot be empty",
    errorType: "empty_agent",
    fixHint: "提供非空的 subagent_type 值",
  },
  {
    pattern: "Unknown agent",
    errorType: "unknown_agent",
    fixHint: "使用错误消息中可用 Agent 列表中的有效 Agent",
  },
  {
    pattern: "Cannot call primary agent",
    errorType: "primary_agent",
    fixHint:
      "主要 Agent 不能通过 task 调用。请使用子 Agent，如 'explore'、'oracle' 或 'librarian'",
  },
  {
    pattern: "Skills not found",
    errorType: "unknown_skills",
    fixHint: "使用错误消息中可用列表中的有效技能名称",
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
