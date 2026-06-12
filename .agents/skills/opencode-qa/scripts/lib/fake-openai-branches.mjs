export const branchCounts = {
  title: 0,
  "parent-tool-call": 0,
  "parent-hold": 0,
  child: 0,
  wake: 0,
  default: 0,
}

export const latches = {
  parentToolCallIssued: false,
  parentHoldIssued: false,
}

export function hasToolResult(inputStr) {
  return (
    inputStr.includes('"type":"function_call_output"') ||
    inputStr.includes('"type": "function_call_output"') ||
    inputStr.includes('"type":"tool_result"') ||
    inputStr.includes('"type": "tool_result"') ||
    inputStr.includes('"role":"tool"') ||
    inputStr.includes('"role": "tool"')
  )
}

export function selectBranch(inputStr) {
  const isTitle = inputStr.includes("Generate a title")
  const isSplitProbe = inputStr.includes("Run the split probe")
  const isChild = inputStr.includes("SPLIT_CHILD_TASK")
  const isWake = inputStr.includes("[BACKGROUND TASK")
  const hasResult = hasToolResult(inputStr)

  if (isTitle) return "title"
  if (isChild && !isSplitProbe) return "child"
  if (isWake) return "wake"
  if (isSplitProbe && !hasResult && !latches.parentToolCallIssued) return "parent-tool-call"
  if (isSplitProbe && (hasResult || latches.parentToolCallIssued) && !latches.parentHoldIssued) return "parent-hold"
  return "default"
}
