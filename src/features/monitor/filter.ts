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
