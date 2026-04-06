import type { ReviewVerdict } from "./types"

export function parseReviewFile(content: string): {
  verdict: ReviewVerdict
  score: number
  maxScore: number
  criticalIssues: string[]
} {
  let verdict: ReviewVerdict = null
  let score = 0
  const maxScore = 40
  const criticalIssues: string[] = []

  const verdictMatch = content.match(/(?:Verdict|VERDICT)[**:]*\s*(APPROVE|REJECT|CONDITIONAL)/i)
  if (verdictMatch) {
    verdict = verdictMatch[1].toUpperCase() as ReviewVerdict
  }

  const scoreMatch = content.match(/(?:Score|SCORE)[**:]*\s*(\d+)\s*(?:\/|out of)\s*(\d+)/i)
  if (scoreMatch) {
    score = parseInt(scoreMatch[1], 10)
  }

  const criticalSection = content.match(/(?:###?\s*)?(?:Critical Issues|CRITICAL|BLOCKING):?\s*\n?([\s\S]*?)(?=\n#{1,3}\s|$)/i)
  if (criticalSection) {
    const lines = criticalSection[1].split("\n")
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed && (trimmed.startsWith("-") || trimmed.startsWith("*") || /^\d+\./.test(trimmed))) {
        criticalIssues.push(trimmed.replace(/^[-*\d.\s]+/, ""))
      }
    }
  }

  return { verdict, score, maxScore, criticalIssues }
}
