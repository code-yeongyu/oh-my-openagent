export const FEEDBACK_SECTION_IDS = [
  "description",
  "identity",
  "environment",
  "session",
  "logs",
  "crash",
  "config",
] as const
export type FeedbackSectionId = (typeof FEEDBACK_SECTION_IDS)[number]
export type FeedbackKind = "bug" | "feedback" | "other"

export interface FeedbackDraftSection {
  readonly id: FeedbackSectionId
  readonly title: string
  readonly text: string
  readonly redactedCount: number
  readonly bytes: number
}

export interface FeedbackDraft {
  readonly draftId: string
  readonly sections: readonly FeedbackDraftSection[]
  readonly destination: "intake" | "local"
  readonly retentionDays: number
  readonly signedIn: boolean
  readonly totalBytes: number
  readonly redactedCount: number
}

export interface CollectedSection {
  readonly id: FeedbackSectionId
  readonly text: string
  readonly verbatim?: boolean
}

export interface Redaction {
  readonly text: string
  readonly count: number
}

/** The one upload redactor (senpi `pi.redactForUpload`, code-yeongyu/senpi#3674). Must be idempotent. */
export type UploadRedactor = (text: string) => Redaction

export const REPORT_RETENTION_DAYS = 90

const SECTION_TITLES: Readonly<Record<FeedbackSectionId, string>> = {
  description: "Description",
  identity: "Who you are",
  environment: "App and system",
  session: "This conversation",
  logs: "Logs and recent errors",
  crash: "Crash report",
  config: "Settings",
}

export const byteLength = (text: string): number => new TextEncoder().encode(text).byteLength

export interface BuildDraftOptions {
  readonly draftId: string
  readonly collected: readonly CollectedSection[]
  readonly redact: UploadRedactor
  readonly destination: "intake" | "local"
  readonly signedIn: boolean
}

/**
 * The exact report that leaves the machine: every section except a `verbatim` one (the identity block, whose values
 * are the point of collecting it) goes through the one redactor, and sections come out in the fixed section order
 * whatever order they were collected in. The description is always present, empty until the user writes it.
 */
export function buildDraft(options: BuildDraftOptions): FeedbackDraft {
  const byId = new Map(options.collected.map((section) => [section.id, section]))
  const sections: FeedbackDraftSection[] = []
  for (const id of FEEDBACK_SECTION_IDS) {
    const collected = byId.get(id) ?? (id === "description" ? { id, text: "" } : undefined)
    if (collected === undefined) continue
    const redacted = collected.verbatim === true ? { text: collected.text, count: 0 } : options.redact(collected.text)
    sections.push({
      id,
      title: SECTION_TITLES[id],
      text: redacted.text,
      redactedCount: redacted.count,
      bytes: byteLength(redacted.text),
    })
  }
  return {
    draftId: options.draftId,
    destination: options.destination,
    retentionDays: REPORT_RETENTION_DAYS,
    signedIn: options.signedIn,
    sections,
    totalBytes: sections.reduce((sum, section) => sum + section.bytes, 0),
    redactedCount: sections.reduce((sum, section) => sum + section.redactedCount, 0),
  }
}
