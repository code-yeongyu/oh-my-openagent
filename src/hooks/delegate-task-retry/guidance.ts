import { DELEGATE_TASK_ERROR_PATTERNS, type DetectedError } from "./patterns"

function extractAvailableList(output: string): string | null {
  const availableMatch = output.match(/Available[^:]*:\s*(.+)$/m)
  return availableMatch ? availableMatch[1].trim() : null
}

const ERROR_TYPE_LANE_HINTS: Record<string, string> = {
  unknown_agent: "Category names (like 'quick', 'deep') go in the 'category' parameter. Agent names (like 'explore', 'oracle') go in 'subagent_type'.",
  empty_agent: "Use 'category' for task delegation, or 'subagent_type' for direct agent invocation.",
  primary_agent: "Primary agents cannot be called via task. Use a category (e.g., 'quick') to spawn Sisyphus-Junior instead.",
}

export function buildRetryGuidance(errorInfo: DetectedError): string {
  const pattern = DELEGATE_TASK_ERROR_PATTERNS.find(
    (p) => p.errorType === errorInfo.errorType
  )

  if (!pattern) {
    return `[task ERROR] Fix the error and retry with correct parameters.`
  }

  let guidance = `
 [task CALL FAILED - IMMEDIATE RETRY REQUIRED]
 
 **Error Type**: ${errorInfo.errorType}
 **Fix**: ${pattern.fixHint}
 `

  const availableList = extractAvailableList(errorInfo.originalOutput)
  if (availableList) {
    guidance += `\n**Available Options**: ${availableList}\n`
  }

  const laneHint = ERROR_TYPE_LANE_HINTS[errorInfo.errorType]
  if (laneHint) {
    guidance += `\n**Lane Hint**: ${laneHint}\n`
  }

  guidance += `
 **Action**: Retry task NOW with corrected parameters.
 
 Example of CORRECT call:
 \`\`\`
 task(
   description="Task description",
   prompt="Detailed prompt...",
   category="unspecified-low",  // OR subagent_type="explore"
   run_in_background=false,
   load_skills=[]
 )
 \`\`\`
 `

  return guidance
}
