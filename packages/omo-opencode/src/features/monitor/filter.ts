export interface MonitorFilterResult {
  filter: { matches(text: string): boolean } | null
  error?: string
  pattern?: string
}

const ANSI_COLOR_PATTERN = /\x1b\[[0-9;]*m/g

function stripAnsi(text: string): string {
  return text.replace(ANSI_COLOR_PATTERN, "")
}

function getRegexError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return String(error)
}

interface QuantifierScan {
  readonly length: number
  readonly repeated: boolean
  readonly unbounded: boolean
}

function scanQuantifier(pattern: string, index: number): QuantifierScan {
  const ch = pattern[index]
  if (ch === "*" || ch === "+") {
    const lazy = pattern[index + 1] === "?" ? 1 : 0
    return { length: 1 + lazy, repeated: true, unbounded: true }
  }
  if (ch === "?") {
    return { length: 1, repeated: false, unbounded: false }
  }
  if (ch === "{") {
    const close = pattern.indexOf("}", index)
    if (close === -1) {
      return { length: 0, repeated: false, unbounded: false }
    }
    const braceMatch = /^(\d+)(,(\d*))?$/.exec(pattern.slice(index + 1, close))
    if (!braceMatch) {
      return { length: 0, repeated: false, unbounded: false }
    }
    const min = Number(braceMatch[1])
    const hasComma = braceMatch[2] !== undefined
    const maxRaw = braceMatch[3]
    const unbounded = hasComma && (maxRaw === undefined || maxRaw === "")
    const max = unbounded ? Number.POSITIVE_INFINITY : hasComma && maxRaw ? Number(maxRaw) : min
    const lazy = pattern[close + 1] === "?" ? 1 : 0
    return { length: close - index + 1 + lazy, repeated: unbounded || max >= 2, unbounded }
  }
  return { length: 0, repeated: false, unbounded: false }
}

interface GroupFrame {
  hasUnboundedQuant: boolean
}

function isPotentiallyCatastrophicRegex(pattern: string): boolean {
  const groupStack: GroupFrame[] = []
  let inCharClass = false

  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i]
    if (ch === "\\") {
      i += 1
      continue
    }
    if (inCharClass) {
      if (ch === "]") {
        inCharClass = false
      }
      continue
    }
    if (ch === "[") {
      inCharClass = true
      continue
    }
    if (ch === "(") {
      groupStack.push({ hasUnboundedQuant: false })
      continue
    }
    if (ch === ")") {
      const frame = groupStack.pop()
      const quant = scanQuantifier(pattern, i + 1)
      if (quant.repeated && frame?.hasUnboundedQuant) {
        return true
      }
      if (groupStack.length > 0 && (quant.unbounded || frame?.hasUnboundedQuant)) {
        groupStack[groupStack.length - 1].hasUnboundedQuant = true
      }
      i += quant.length
      continue
    }
    if (ch === "*" || ch === "+" || ch === "{") {
      const quant = scanQuantifier(pattern, i)
      if (quant.unbounded && groupStack.length > 0) {
        groupStack[groupStack.length - 1].hasUnboundedQuant = true
      }
      if (quant.length > 1) {
        i += quant.length - 1
      }
    }
  }

  return false
}

export function createMonitorFilter(
  pattern: string | undefined,
  opts: { patternMaxLength: number },
): MonitorFilterResult {
  if (!pattern) {
    return {
      filter: { matches: () => true },
    }
  }

  if (pattern.length > opts.patternMaxLength) {
    return {
      filter: null,
      error: "pattern too long",
    }
  }

  if (isPotentiallyCatastrophicRegex(pattern)) {
    return {
      filter: null,
      error: "unsafe pattern: nested quantifiers can cause catastrophic backtracking (ReDoS)",
    }
  }

  let re: RegExp

  try {
    re = new RegExp(pattern)
  } catch (error) {
    return {
      filter: null,
      error: `invalid regex: ${getRegexError(error)}`,
    }
  }

  return {
    filter: {
      matches: (text: string) => re.test(stripAnsi(text)),
    },
    pattern,
  }
}
