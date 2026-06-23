export const MOC_NAMES = [
  "MOC - Decisions",
  "MOC - Discoveries",
  "MOC - Engineering",
  "MOC - Conventions",
] as const

export type MocName = (typeof MOC_NAMES)[number]

export function routeMemoryTypeToMoc(
  memoryType:
    | "decision"
    | "discovery"
    | "bugfix"
    | "feature"
    | "change"
    | "rule"
    | "convention"
    | "benchmark",
): MocName {
  switch (memoryType) {
    case "decision":
      return "MOC - Decisions"
    case "discovery":
    case "benchmark":
      return "MOC - Discoveries"
    case "bugfix":
    case "feature":
    case "change":
      return "MOC - Engineering"
    case "rule":
    case "convention":
      return "MOC - Conventions"
  }
}

export type ZettelStatus = "seed" | "budding" | "evergreen" | "archived"

export interface CartographerDraft {
  title: string
  summary: string
  principio_guida: string
  body_markdown: string
  tags: string[]
  moc: MocName | string
  status: ZettelStatus
  related: string[]
}

export interface CartographerResponse {
  draft: CartographerDraft | null
  rationale: string
  confidence: number
  warnings: string[]
}

export interface CartographerInput {
  source_memories: unknown[]
  related_context: unknown[]
  project_id: string
  target_moc_hint?: MocName | string
  current_date: string
}

export interface InboxDraftFile {
  filename: string
  path: string
  markdown: string
  memory_ids: string[]
}

export interface MeetingGateState {
  last_meeting_at?: string
  inbox_draft_count: number
  idle_since?: string
  has_user_override: boolean
}

export interface MeetingDecision {
  should_hold: boolean
  reason: string
  suggested_drafts: number
}
