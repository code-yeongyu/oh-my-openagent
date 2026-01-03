import type { ConstraintViolation } from "../../features/knowledge-repo/types"
import type { ViolationReport, InterruptionDecision } from "./types"
import {
  VIOLATION_HEADER,
  BLOCK_SUFFIX,
  WARN_SUFFIX,
  INFO_SUFFIX,
} from "./constants"

export function decideInterruption(report: ViolationReport): InterruptionDecision {
  const { violations, highestSeverity, shouldBlock, message } = report

  if (shouldBlock) {
    return {
      shouldInterrupt: true,
      shouldBlock: true,
      message: formatInterruptionMessage(message, "block"),
      violations,
    }
  }

  if (highestSeverity === "warn") {
    return {
      shouldInterrupt: true,
      shouldBlock: false,
      message: formatInterruptionMessage(message, "warn"),
      violations,
    }
  }

  return {
    shouldInterrupt: true,
    shouldBlock: false,
    message: formatInterruptionMessage(message, "info"),
    violations,
  }
}

function formatInterruptionMessage(violationDetails: string, severity: "block" | "warn" | "info"): string {
  let suffix = ""
  switch (severity) {
    case "block":
      suffix = BLOCK_SUFFIX
      break
    case "warn":
      suffix = WARN_SUFFIX
      break
    case "info":
      suffix = INFO_SUFFIX
      break
  }

  return `${VIOLATION_HEADER}${violationDetails}${suffix}`
}

export function formatViolationSummary(violations: ConstraintViolation[]): string {
  const byKnowledge = new Map<string, ConstraintViolation[]>()
  
  for (const v of violations) {
    const existing = byKnowledge.get(v.knowledgeId) ?? []
    existing.push(v)
    byKnowledge.set(v.knowledgeId, existing)
  }

  const lines: string[] = []
  for (const [knowledgeId, vList] of byKnowledge) {
    lines.push(`Knowledge: ${knowledgeId}`)
    for (const v of vList) {
      lines.push(`  - [${v.severity.toUpperCase()}] ${v.message}`)
    }
  }

  return lines.join("\n")
}

export function shouldSkipTool(toolName: string, config: { ignoredTools?: string[] }): boolean {
  const ignored = config.ignoredTools ?? []
  return ignored.includes(toolName.toLowerCase())
}

export function extractFilePath(args: Record<string, unknown>): string | undefined {
  return (args.filePath ?? args.file_path ?? args.path) as string | undefined
}

export function extractContent(args: Record<string, unknown>): string | undefined {
  return args.content as string | undefined
}

export function extractEditParams(
  args: Record<string, unknown>
): { oldString?: string; newString?: string } {
  return {
    oldString: (args.oldString ?? args.old_string) as string | undefined,
    newString: (args.newString ?? args.new_string) as string | undefined,
  }
}

export function extractEdits(
  args: Record<string, unknown>
): Array<{ old_string: string; new_string: string }> | undefined {
  return args.edits as Array<{ old_string: string; new_string: string }> | undefined
}

export function extractCommand(args: Record<string, unknown>): string | undefined {
  return args.command as string | undefined
}
