import { parseFrontmatter } from "../../shared/frontmatter"
import { log } from "../../shared/logger"
import type { TtsrRule } from "./types"

interface RuleFrontmatter {
  condition?: string | string[]
  ttsr_trigger?: string | string[]
  ttsrTrigger?: string | string[]
  scope?: string | string[]
  globs?: string | string[]
}

function toStringArray(value: string | string[]): string[] {
  return Array.isArray(value) ? value : [value]
}

export function parseTtsrRule(name: string, fileContent: string, path?: string): TtsrRule | null {
  const { data, body } = parseFrontmatter<RuleFrontmatter>(fileContent)
  const rawCondition = data.condition ?? data.ttsr_trigger ?? data.ttsrTrigger

  if (!rawCondition) {
    return null
  }

  const condition = toStringArray(rawCondition)

  for (const cond of condition) {
    try {
      new RegExp(cond)
    } catch {
      log(`[ttsr] Invalid regex in rule "${name}": ${cond}`)
      return null
    }
  }

  const scope = typeof data.scope === "string"
    ? data.scope.split(",").map((token) => token.trim()).filter(Boolean)
    : data.scope
      ? toStringArray(data.scope)
      : []

  const globs = data.globs
    ? toStringArray(data.globs)
    : undefined

  return {
    name,
    content: body.trim(),
    path,
    condition,
    scope,
    globs,
  }
}
