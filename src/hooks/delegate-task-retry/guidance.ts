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
    return `[task 错误] 请修复错误并使用正确的参数重试。`
  }

  let guidance = `
 [task 调用失败 - 需要立即重试]
 
 **错误类型**：${errorInfo.errorType}
 **修复方法**：${pattern.fixHint}
 `

  const availableList = extractAvailableList(errorInfo.originalOutput)
  if (availableList) {
    guidance += `\n**可用选项**：${availableList}\n`
  }

  guidance += `
 **操作**：立即使用修正后的参数重试 task。
 
 正确调用的示例：
 \`\`\`
 task(
   description="任务描述",
   prompt="详细的提示...",
   category="unspecified-low",  // 或 subagent_type="explore"
   run_in_background=false,
   load_skills=[]
 )
 \`\`\`
 `

  return guidance
}
