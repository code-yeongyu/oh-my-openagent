import type { SkippedFile } from "./corpus"

export const MEMORY_CLEANUP_CLASSES = ["duplicate", "superseded", "stale", "conflict"] as const
export type MemoryCleanupClass = (typeof MEMORY_CLEANUP_CLASSES)[number]

export interface CleanupEvidence {
  readonly kind: string
  readonly detail: string
  /** `path:line` of the declaration the evidence quotes, when it has one. */
  readonly at?: string
}

export type CleanupAction =
  | { readonly kind: "archive"; readonly path: string; readonly reason: string; readonly successor?: string }
  | { readonly kind: "merge"; readonly into: string; readonly from: string; readonly paragraphs: readonly string[] }
  | { readonly kind: "mark-conflict"; readonly path: string; readonly other: string }

export interface MemoryCleanupFinding {
  readonly id: string
  readonly class: MemoryCleanupClass
  /** The note the finding is about: the one archived, or one side of a conflict. */
  readonly subject: string
  /** The canonical copy, the successor, or the other side of a conflict. */
  readonly related?: string
  readonly evidence: readonly CleanupEvidence[]
  readonly actions: readonly CleanupAction[]
  /** Every repository path apply would write for this finding. */
  readonly touches: readonly string[]
}

export interface HeldFinding extends MemoryCleanupFinding {
  readonly held: string
}

export interface KeptNote {
  readonly kind: "series-diverges" | "conflict-marked" | "skipped-by-option" | "party-archived"
  readonly detail: string
  readonly paths: readonly string[]
}

export interface MemoryCleanupBudget {
  readonly systemFiles: number
  readonly tokensBefore: number
  readonly tokensAfter: number
  readonly budgetTokens?: number
}

export interface MemoryCleanupOptions {
  readonly now?: number
  /** Jaccard over normalised paragraphs at or above which two notes are one fact written twice. */
  readonly similarity?: number
  /** Share of an older dated note's paragraphs the newer one must carry to plainly cover it. */
  readonly containment?: number
  /** Allow writes to the load-bearing projections (`system/persona.md`, `system/human.md`, identity, agreements). */
  readonly includeLoadBearing?: boolean
  readonly only?: readonly MemoryCleanupClass[]
  /** Repository paths a person vetoed after reading the report; a finding naming one is kept, not applied. */
  readonly skip?: readonly string[]
  readonly budgetTokens?: number
}

export interface ResolvedCleanupOptions {
  readonly now: number
  readonly similarity: number
  readonly containment: number
  readonly includeLoadBearing: boolean
  readonly only: readonly MemoryCleanupClass[]
  readonly skip: readonly string[]
  readonly budgetTokens: number | undefined
}

export interface MemoryCleanupSummary {
  readonly archive: number
  readonly merge: number
  readonly mark: number
  /** Notes whose only change is a repointed link. */
  readonly repoint: number
}

export interface MemoryCleanupPlan {
  readonly version: 1
  readonly repoDir: string
  readonly generatedAt: string
  readonly options: ResolvedCleanupOptions
  readonly scanned: {
    readonly notes: number
    readonly byHome: Readonly<Record<string, number>>
    readonly skipped: readonly SkippedFile[]
  }
  readonly findings: readonly MemoryCleanupFinding[]
  readonly held: readonly HeldFinding[]
  readonly kept: readonly KeptNote[]
  readonly budget: MemoryCleanupBudget
  readonly summary: MemoryCleanupSummary
  /** Content hash of every note the plan would write; apply refuses to run when one has changed. */
  readonly snapshot: Readonly<Record<string, string>>
}

const DEFAULT_CLEANUP_SIMILARITY = 0.9
const DEFAULT_CLEANUP_CONTAINMENT = 0.9

export const LOAD_BEARING_PATHS: ReadonlySet<string> = new Set([
  "system/persona.md",
  "system/human.md",
  "system/identity.md",
  "system/agreements.md",
])

export function resolveCleanupOptions(options: MemoryCleanupOptions): ResolvedCleanupOptions {
  return {
    now: options.now ?? Date.now(),
    similarity: options.similarity ?? DEFAULT_CLEANUP_SIMILARITY,
    containment: options.containment ?? DEFAULT_CLEANUP_CONTAINMENT,
    includeLoadBearing: options.includeLoadBearing ?? false,
    only: options.only ?? MEMORY_CLEANUP_CLASSES,
    skip: options.skip ?? [],
    budgetTokens: options.budgetTokens,
  }
}
