import { basename } from "path"
import { parseFrontmatter } from "../../shared"
import type { LegacyContextFile, NormalizedContext } from "./types"

function getTopicFromFilename(filename: string): string {
  const base = basename(filename || "", ".md").trim()
  if (!base) {
    return "untitled"
  }

  const normalized = base.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim()
  return normalized || "untitled"
}

function getFrontmatterTopic(data: Record<string, unknown>): string | null {
  const topic = data.topic
  if (typeof topic !== "string") {
    return null
  }

  const trimmed = topic.trim()
  return trimmed ? trimmed : null
}

function getFrontmatterTags(data: Record<string, unknown>): string[] {
  const tags = data.tags
  if (!Array.isArray(tags)) {
    return []
  }

  return tags
    .filter((tag): tag is string => typeof tag === "string")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0)
}

export function normalizeLegacyContext(file: LegacyContextFile): NormalizedContext {
  const parsed = parseFrontmatter<Record<string, unknown>>(file.content)
  const source = typeof parsed.data.source === "string" ? parsed.data.source : file.source
  const topic = getFrontmatterTopic(parsed.data) ?? getTopicFromFilename(file.filename)
  const content = parsed.hadFrontmatter && !parsed.parseError ? parsed.body : file.content
  const tags = [...new Set([...getFrontmatterTags(parsed.data), file.source])]

  return {
    topic,
    content,
    tags,
    source,
    normalizedAt: Date.now(),
  }
}
