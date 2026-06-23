import type { SessionSummaryRow } from "./types"

type SummarySection = {
  label: string
  value: string | null | undefined
}

export function formatSessionSummary(row: SessionSummaryRow | null): string | undefined {
  if (!row) return undefined

  const legacySummary = row.summary_text?.trim()
  if (legacySummary) return legacySummary

  const sections: SummarySection[] = [
    { label: "Request", value: row.request },
    { label: "Investigated", value: row.investigated },
    { label: "Learned", value: row.learned },
    { label: "Completed", value: row.completed },
    { label: "Next steps", value: row.next_steps },
    { label: "Files read", value: row.files_read },
    { label: "Files edited", value: row.files_edited },
    { label: "Notes", value: row.notes },
  ]

  const parts = sections
    .map(({ label, value }) => ({ label, value: value?.trim() }))
    .filter((section): section is { label: string; value: string } => Boolean(section.value))

  if (parts.length === 0) return undefined

  return parts.map(({ label, value }) => `${label}: ${value}`).join("\n")
}
