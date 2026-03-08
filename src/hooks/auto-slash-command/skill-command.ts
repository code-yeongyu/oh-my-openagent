import { discoverAllSkills } from "../../features/opencode-skill-loader"
import type { ExecutorOptions, ExecuteResult } from "./executor"

const SCOPE_ORDER = ["project", "user", "opencode", "builtin"] as const
type Scope = (typeof SCOPE_ORDER)[number]

function scopeLabel(scope: string): string {
  switch (scope) {
    case "project":
      return "project"
    case "user":
      return "user"
    case "builtin":
      return "builtin"
    default:
      return scope
  }
}

function matchesQuery(name: string, description: string, query: string): boolean {
  const q = query.toLowerCase()
  return name.toLowerCase().includes(q) || description.toLowerCase().includes(q)
}

function formatSkillList(skills: Array<{ name: string; scope: string; description: string }>, query: string): string {
  const lines: string[] = []

  lines.push("Present this skill list to the user as your complete response. Do not add commentary or ask follow-up questions.\n")

  if (query) {
    lines.push(`# Skills matching "${query}"\n`)
  } else {
    lines.push("# Available Skills\n")
  }

  const grouped = new Map<string, typeof skills>()
  for (const s of skills) {
    const bucket = grouped.get(s.scope) ?? []
    bucket.push(s)
    grouped.set(s.scope, bucket)
  }

  const orderedScopes = [...SCOPE_ORDER].filter((sc) => grouped.has(sc))
  const remaining = [...grouped.keys()].filter((sc) => !SCOPE_ORDER.includes(sc as Scope))

  for (const scope of [...orderedScopes, ...remaining]) {
    const bucket = grouped.get(scope)
    if (!bucket?.length) continue
    lines.push(`## ${scopeLabel(scope)}\n`)
    for (const s of bucket) {
      const desc = s.description ? ` — ${s.description}` : ""
      lines.push(`- **${s.name}**${desc}`)
    }
    lines.push("")
  }

  if (skills.length === 0) {
    lines.push(query ? `No skills found matching "${query}".` : "No skills available.")
    lines.push("")
  }

  lines.push("---")
  lines.push("Activate a skill: `/skill-name` in TUI or `skill(name=\"skill-name\")` from an agent.")

  return lines.join("\n")
}

export async function handleSkillCommand(query: string, options?: ExecutorOptions): Promise<ExecuteResult> {
  try {
    const allSkills = options?.skills ?? await discoverAllSkills()
    const entries = allSkills.map((s) => ({
      name: s.name,
      scope: s.scope ?? "user",
      description: s.definition.description ?? "",
    }))

    const filtered = query.trim()
      ? entries.filter((s) => matchesQuery(s.name, s.description, query.trim()))
      : entries

    return {
      success: true,
      replacementText: formatSkillList(filtered, query.trim()),
    }
  } catch (err) {
    return {
      success: false,
      error: `Failed to list skills: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}
