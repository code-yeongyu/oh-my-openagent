import { parseFrontmatter } from "../../shared/frontmatter"

type SkillPriority = "high" | "medium" | "low"

interface SkillFrontmatterData {
  description?: unknown
  hooks?: unknown
  triggers?: unknown
  priority?: unknown
}

export interface ParsedSkillTemplate {
  template: string
  description?: string
  hooks: string[]
  triggers: string[]
  priority: SkillPriority
  hasFrontmatter: boolean
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
}

function normalizePriority(value: unknown): SkillPriority {
  if (value === "high" || value === "low" || value === "medium") {
    return value
  }
  return "medium"
}

export function parseSkillTemplate(content: string): ParsedSkillTemplate {
  const { data, body, hadFrontmatter } = parseFrontmatter<SkillFrontmatterData>(content)

  return {
    template: body.trim(),
    description: typeof data.description === "string" ? data.description.trim() : undefined,
    hooks: normalizeStringArray(data.hooks),
    triggers: normalizeStringArray(data.triggers),
    priority: normalizePriority(data.priority),
    hasFrontmatter: hadFrontmatter,
  }
}
