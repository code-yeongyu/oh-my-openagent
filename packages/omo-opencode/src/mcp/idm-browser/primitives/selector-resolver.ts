import type { ActionCache } from "./action-cache"

export type SelectorResolveResult = {
  selector: string
  source: "cache" | "llm" | "heuristic"
  confidence: number
}

export async function resolveSelector(
  instruction: string,
  urlPattern: string,
  _pageContent: string,
  cache: ActionCache | null,
): Promise<SelectorResolveResult> {
  if (cache) {
    const cached = cache.lookup(instruction, urlPattern)
    if (cached) {
      return { selector: cached.selector, source: "cache", confidence: 0.95 }
    }
  }

  const heuristicSelector = heuristicResolve(instruction)
  if (heuristicSelector) {
    cache?.store(instruction, urlPattern, heuristicSelector)
    return { selector: heuristicSelector, source: "heuristic", confidence: 0.7 }
  }

  // LLM resolution will be wired in Task 11/12; for Phase 1, return a fallback
  return { selector: `text="${instruction}"`, source: "heuristic", confidence: 0.3 }
}

function heuristicResolve(instruction: string): string | null {
  const lower = instruction.toLowerCase()

  if (lower.startsWith("click ")) {
    const target = instruction.slice(6).trim()
    return `text="${target}"`
  }

  if (lower.startsWith("type ") && lower.includes(" into ")) {
    const parts = lower.split(" into ")
    if (parts.length === 2) {
      const fieldName = parts[1]!.trim()
      return `[placeholder*="${fieldName}" i], [name*="${fieldName}" i], [aria-label*="${fieldName}" i]`
    }
  }

  return null
}
