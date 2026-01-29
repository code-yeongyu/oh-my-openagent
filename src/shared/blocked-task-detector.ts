/**
 * Blocked Task Detector
 * 
 * Detects AI responses that indicate a task is truly blocked and cannot proceed.
 * Used to prevent infinite loops when continuation enforcement encounters genuine blockers.
 */

/**
 * Keywords that indicate a task is blocked and cannot proceed.
 * These represent true blockers (environment issues, external dependencies, etc.)
 * NOT fixable errors like build failures or test failures.
 */
export const BLOCKED_KEYWORDS = [
  // English blocking keywords
  "blocked",
  "cannot complete",
  "cannot proceed",
  "requires user",
  "need user intervention",
  "remains blocked",
  "still blocked",
  "segfault",
  "external blocker",
  "environment issue",
  
  // Chinese blocking keywords
  "被阻塞",
  "无法继续",
  "需要用户介入",
  "无法完成",
  "仍然阻塞",
  "环境问题",
]

/**
 * Check if AI response content indicates the task is blocked.
 * 
 * @param content - The AI response content to check
 * @returns true if content contains blocking keywords, false otherwise
 * 
 * @example
 * isBlockedResponse("任务被 Bun segfault 阻塞") // true
 * isBlockedResponse("Cannot complete - requires user intervention") // true
 * isBlockedResponse("Build failed with 3 errors") // false (fixable)
 * isBlockedResponse("任务完成，继续下一个?") // false (normal)
 */
export function isBlockedResponse(content: string): boolean {
  if (!content) return false
  
  const lowerContent = content.toLowerCase()
  return BLOCKED_KEYWORDS.some(keyword => lowerContent.includes(keyword.toLowerCase()))
}
