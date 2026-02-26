export type RalphLoopStrategy = "reset" | "continue"

export type ParsedRalphLoopArguments = {
  prompt: string
  maxIterations?: number
  completionPromise?: string
  strategy?: RalphLoopStrategy
}

const DEFAULT_PROMPT = "Complete the task as instructed"
const RESET_PROMPT_BLOCK_START = "<ralph-prompt>"
const RESET_PROMPT_BLOCK_END = "</ralph-prompt>"

type ParsedQuoted = {
  value: string
  endIndex: number
}

function decodeEscapedCharacter(char: string): string {
  if (char === "n") return "\n"
  if (char === "r") return "\r"
  if (char === "t") return "\t"
  return char
}

function parseQuotedAt(input: string, startIndex: number): ParsedQuoted | null {
  const quote = input[startIndex]
  if (quote !== '"' && quote !== "'") {
    return null
  }

  let value = ""
  let escaped = false

  for (let index = startIndex + 1; index < input.length; index++) {
    const char = input[index]

    if (escaped) {
      value += decodeEscapedCharacter(char)
      escaped = false
      continue
    }

    if (char === "\\") {
      escaped = true
      continue
    }

    if (char === quote) {
      return { value, endIndex: index + 1 }
    }

    value += char
  }

  return null
}

function parseLeadingPrompt(rawArguments: string): { prompt: string; flagsSource: string } {
  let firstNonWhitespace = 0
  while (firstNonWhitespace < rawArguments.length && /\s/.test(rawArguments[firstNonWhitespace] ?? "")) {
    firstNonWhitespace += 1
  }

  const resetPromptBlockStart = rawArguments.indexOf(RESET_PROMPT_BLOCK_START, firstNonWhitespace)
  if (resetPromptBlockStart === firstNonWhitespace) {
    const promptStart = resetPromptBlockStart + RESET_PROMPT_BLOCK_START.length
    const resetPromptBlockEnd = rawArguments.indexOf(RESET_PROMPT_BLOCK_END, promptStart)

    if (resetPromptBlockEnd !== -1) {
      const blockBody = rawArguments.slice(promptStart, resetPromptBlockEnd)
      const prompt = blockBody.replace(/^\r?\n/, "").replace(/\r?\n$/, "") || DEFAULT_PROMPT
      return {
        prompt,
        flagsSource: rawArguments.slice(resetPromptBlockEnd + RESET_PROMPT_BLOCK_END.length),
      }
    }
  }

  const leadingQuotedPrompt = parseQuotedAt(rawArguments, firstNonWhitespace)
  if (leadingQuotedPrompt) {
    return {
      prompt: leadingQuotedPrompt.value || DEFAULT_PROMPT,
      flagsSource: rawArguments.slice(leadingQuotedPrompt.endIndex),
    }
  }

  if (rawArguments.slice(firstNonWhitespace).startsWith("--")) {
    return {
      prompt: DEFAULT_PROMPT,
      flagsSource: rawArguments,
    }
  }

  const promptSegment = rawArguments.split(/\s+--/)[0] ?? ""
  const promptCandidate = promptSegment.trim()
  return {
    prompt: promptCandidate || DEFAULT_PROMPT,
    flagsSource: rawArguments.slice(promptSegment.length),
  }
}

function parseQuotedFlagValue(flagsSource: string, flagName: string): string | undefined {
  const flagPattern = new RegExp(`(?:^|\\s)--${flagName}=`, "i")
  const match = flagPattern.exec(flagsSource)
  if (!match) {
    return undefined
  }

  const valueStart = (match.index ?? 0) + match[0].length
  const quoted = parseQuotedAt(flagsSource, valueStart)
  if (quoted) {
    return quoted.value
  }

  const unquotedSlice = flagsSource.slice(valueStart)
  const unquoted = unquotedSlice.match(/^([^\s"']+)/)
  return unquoted?.[1]
}

export function parseRalphLoopArguments(rawArguments: string): ParsedRalphLoopArguments {
  const { prompt, flagsSource } = parseLeadingPrompt(rawArguments)

  const maxIterationMatch = flagsSource.match(/--max-iterations=(\d+)/i)
  const completionPromise = parseQuotedFlagValue(flagsSource, "completion-promise")
  const strategyMatch = flagsSource.match(/--strategy=(reset|continue)/i)
  const strategyValue = strategyMatch?.[1]?.toLowerCase()

  return {
    prompt,
    maxIterations: maxIterationMatch ? Number.parseInt(maxIterationMatch[1], 10) : undefined,
    completionPromise,
    strategy: strategyValue === "reset" || strategyValue === "continue" ? strategyValue : undefined,
  }
}
