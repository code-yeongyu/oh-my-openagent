import type { MemorianGateLaunchInput } from "./memorian-runner"

export function memorianCandidatesPayload(input: MemorianGateLaunchInput): {
  readonly version: 1
  readonly maxItems: number
  readonly candidates: readonly { readonly path: string; readonly description: string; readonly excerpt: string; readonly score: number }[]
  readonly surfaced: readonly string[]
} {
  return {
    version: 1,
    maxItems: input.maxItems,
    candidates: input.candidates.map((candidate) => ({ path: candidate.path, description: candidate.description, excerpt: candidate.excerpt, score: candidate.score })),
    surfaced: [...input.surfaced],
  }
}

export function buildMemorianPrompt(input: MemorianGateLaunchInput): string {
  return [
    "<memorian-input>",
    "<candidates>",
    JSON.stringify(memorianCandidatesPayload(input), null, 2),
    "</candidates>",
    "<transcript-window>",
    renderTranscriptWindow(input.transcript).trimEnd(),
    "</transcript-window>",
    "</memorian-input>",
  ].join("\n")
}

export function renderTranscriptWindow(turns: readonly { readonly role: string; readonly text: string }[]): string {
  return `${turns.map((turn) => `${turn.role}: ${turn.text}`).join("\n\n")}\n`
}
