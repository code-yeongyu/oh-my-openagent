import type { Tier } from "../tier-classifier"

const ERROR_LINE_PATTERN = /(?:error|Error|ERROR|ERR!|FAIL|panic|exception|Exception|TypeError|ReferenceError|SyntaxError)/
const PATH_LINE_PATTERN = /(?:\/[\w.-]+){2,}/
const FUNCTION_SIGNATURE_PATTERN = /(?:function\s+\w+|(?:export\s+)?(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?(?:\(|function)|(?:async\s+)?(?:def|class)\s+\w+)/
const IMPORTANT_LINE_PATTERN = /(?:✓|✗|PASS|FAIL|warn|WARN|deprecated|TODO|FIXME|BREAKING)/

const MAX_WARM_LINES = 5
const MAX_COLD_CHARS = 120

type CompressedToolOutput = {
  compressed: string
  originalLength: number
  extractedLines: number
}

function isKeyLine(line: string): boolean {
  return (
    ERROR_LINE_PATTERN.test(line) ||
    PATH_LINE_PATTERN.test(line) ||
    FUNCTION_SIGNATURE_PATTERN.test(line) ||
    IMPORTANT_LINE_PATTERN.test(line)
  )
}

function extractKeyLines(output: string, maxLines: number): string[] {
  const lines = output.split("\n")
  const keyLines: string[] = []

  for (const line of lines) {
    if (keyLines.length >= maxLines) {
      break
    }
    const trimmed = line.trim()
    if (trimmed.length === 0) {
      continue
    }
    if (isKeyLine(trimmed)) {
      keyLines.push(trimmed)
    }
  }

  if (keyLines.length === 0 && lines.length > 0) {
    for (let i = 0; i < Math.min(3, lines.length); i++) {
      const trimmed = lines[i].trim()
      if (trimmed.length > 0) {
        keyLines.push(trimmed)
      }
    }
  }

  return keyLines
}

function buildToolSummary(toolName: string, output: string): string {
  const lineCount = output.split("\n").length
  const charCount = output.length

  if (charCount < MAX_COLD_CHARS) {
    return `${toolName}: ${output.trim()}`
  }

  return `${toolName} (${lineCount} lines, ${charCount} chars)`
}

export function compressToolOutput(
  output: string,
  toolName: string,
  tier: Tier,
  brainId: number | null,
): CompressedToolOutput | null {
  if (tier === "hot") {
    return null
  }

  const originalLength = output.length

  if (tier === "warm") {
    const keyLines = extractKeyLines(output, MAX_WARM_LINES)
    const totalLines = output.split("\n").length
    const remainingLines = totalLines - keyLines.length

    const brainRef = brainId !== null
      ? ` [brain#${brainId}: ${toolName}]`
      : ""

    const parts = keyLines.join("\n")
    const suffix = remainingLines > 0
      ? `\n... [${remainingLines} more lines${brainRef}]`
      : brainRef ? `\n${brainRef}` : ""

    return {
      compressed: parts + suffix,
      originalLength,
      extractedLines: keyLines.length,
    }
  }

  const summary = buildToolSummary(toolName, output)
  const brainRef = brainId !== null
    ? `[brain#${brainId}: ${summary}]`
    : `[compressed: ${summary}]`

  return {
    compressed: brainRef,
    originalLength,
    extractedLines: 0,
  }
}
