import type { CartographerDraft } from "./types"

export interface RenderInboxZettelInput {
  draft: CartographerDraft
  source_memory_ids: string[]
  origin: "auto-draft" | "manual-draft"
  created_at_iso?: string
}

export function renderInboxZettel(input: RenderInboxZettelInput): string {
  const today = (input.created_at_iso ?? new Date().toISOString()).slice(0, 10)
  const frontmatter = renderFrontmatter(input.draft, today, input.origin, input.source_memory_ids)
  const body = renderBody(input.draft, input.source_memory_ids)
  return `${frontmatter}\n\n${body}\n`
}

function renderFrontmatter(
  draft: CartographerDraft,
  date: string,
  origin: string,
  sourceMemoryIds: string[],
): string {
  const tagLines = draft.tags.map((t) => `  - ${t}`).join("\n")
  const extraTags = ["draft", origin === "auto-draft" ? "draft-auto" : "draft-manual"]
  const fullTagLines = [tagLines, ...extraTags.map((t) => `  - ${t}`)]
    .filter((line) => line.length > 0)
    .join("\n")
  const sourceLine = sourceMemoryIds.length > 0
    ? `source_memory_ids: [${sourceMemoryIds.map((id) => `"${id}"`).join(", ")}]`
    : "source_memory_ids: []"
  const moc = draft.moc.trim()
  const mocValue = moc.length > 0 ? `"[[${moc}]]"` : "null"
  return [
    "---",
    `title: "${escapeQuotes(draft.title)}"`,
    "type: zettel",
    `status: ${draft.status}`,
    `moc: ${mocValue}`,
    "tags:",
    fullTagLines,
    `created: ${date}`,
    `modified: ${date}`,
    `summary: "${escapeQuotes(draft.summary)}"`,
    "index: false",
    "meeting_ready: false",
    `origin: ${origin}`,
    sourceLine,
    "---",
  ].join("\n")
}

function renderBody(draft: CartographerDraft, sourceMemoryIds: string[]): string {
  const segments: string[] = []
  segments.push(`# ${draft.title}`)
  segments.push("")
  segments.push(`> [!TIP] Principio Guida`)
  segments.push(`> ${draft.principio_guida}`)
  segments.push("")
  segments.push(draft.body_markdown.trim())

  const related = draft.related.filter((r) => r.trim().length > 0)
  const mocLink = draft.moc.trim().length > 0 ? `[[${draft.moc.trim()}]]` : undefined
  if (related.length > 0 || mocLink) {
    segments.push("")
    segments.push("## :LiLink: Vedi Anche")
    for (const r of related) {
      segments.push(`- ${r.startsWith("[[") ? r : `[[${r.replace(/^\[\[|\]\]$/g, "")}]]`}`)
    }
    if (mocLink) segments.push(`- ${mocLink}`)
  }

  if (sourceMemoryIds.length > 0) {
    segments.push("")
    segments.push("## :LiRefreshCw: Provenance")
    for (const id of sourceMemoryIds) {
      segments.push(`- \`${id}\``)
    }
  }

  return segments.join("\n")
}

function escapeQuotes(value: string): string {
  return value.replace(/"/g, '\\"')
}
