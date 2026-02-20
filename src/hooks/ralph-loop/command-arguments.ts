export type RalphLoopStrategy = "reset" | "continue"

export type ParsedRalphLoopArguments = {
  prompt: string
  maxIterations?: number
  completionPromise?: string
  strategy?: RalphLoopStrategy
}

const DEFAULT_PROMPT = "Complete the task as instructed"

export function parseRalphLoopArguments(rawArguments: string): ParsedRalphLoopArguments {
  const taskMatch = rawArguments.match(/^["'](.+?)["']/)
  const promptCandidate = taskMatch?.[1] ?? (rawArguments.startsWith("--") ? "" : rawArguments.split(/\s+--/)[0]?.trim() ?? "")
  const prompt = promptCandidate || DEFAULT_PROMPT

  const maxIterationMatch = rawArguments.match(/--max-iterations=(\d+)/i)
  const completionPromiseMatch = rawArguments.match(/--completion-promise=["']?([^"'\s]+)["']?/i)
  const strategyMatch = rawArguments.match(/--strategy=(reset|continue)/i)
  const strategyValue = strategyMatch?.[1]?.toLowerCase()

  return {
    prompt,
    maxIterations: maxIterationMatch ? Number.parseInt(maxIterationMatch[1], 10) : undefined,
    completionPromise: completionPromiseMatch?.[1],
    strategy: strategyValue === "reset" || strategyValue === "continue" ? strategyValue : undefined,
  }
}
