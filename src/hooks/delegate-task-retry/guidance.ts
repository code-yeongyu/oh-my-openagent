import { DELEGATE_TASK_ERROR_PATTERNS, type DetectedError } from "./patterns"

function extractAvailableList(output: string): string | null {
  const availableMatch = output.match(/Available[^:]*:\s*(.+)$/m)
  return availableMatch ? availableMatch[1].trim() : null
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
