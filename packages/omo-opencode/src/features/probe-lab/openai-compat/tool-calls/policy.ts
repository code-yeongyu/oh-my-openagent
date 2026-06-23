import type { ToolChoice } from "../schemas"
import type { ParsedToolCall } from "./parser"

export type ToolChoiceFilterResult = {
  kept: ParsedToolCall[]
  filtered: number
}

export type ParallelCapResult = {
  kept: ParsedToolCall[]
  dropped: number
}

export function applyToolChoicePolicy(
  parsed: ReadonlyArray<ParsedToolCall>,
  toolChoice: ToolChoice | undefined,
): ToolChoiceFilterResult {
  if (toolChoice === undefined || toolChoice === "auto") {
    return { kept: parsed.slice(), filtered: 0 }
  }
  if (toolChoice === "none") {
    return { kept: [], filtered: parsed.length }
  }
  if (toolChoice === "required") {
    return { kept: parsed.slice(), filtered: 0 }
  }
  if (typeof toolChoice === "object" && toolChoice.type === "function") {
    const target = toolChoice.function.name
    const kept: ParsedToolCall[] = []
    let filtered = 0
    for (const c of parsed) {
      if (c.name === target) kept.push(c)
      else filtered += 1
    }
    return { kept, filtered }
  }
  return { kept: parsed.slice(), filtered: 0 }
}

export function applyParallelToolCallsPolicy(
  parsed: ReadonlyArray<ParsedToolCall>,
  parallelEnabled: boolean,
): ParallelCapResult {
  if (parallelEnabled) {
    return { kept: parsed.slice(), dropped: 0 }
  }
  if (parsed.length <= 1) {
    return { kept: parsed.slice(), dropped: 0 }
  }
  const first = parsed[0]
  if (first === undefined) {
    return { kept: [], dropped: 0 }
  }
  return { kept: [first], dropped: parsed.length - 1 }
}
