import { tool } from "@opencode-ai/plugin"
import { existsSync, readdirSync, statSync, readlinkSync, readFileSync } from "fs"
import { homedir } from "os"
import { join, resolve, basename } from "path"
import { parseFrontmatter, resolveCommandsInText } from "../../shared"
import type { SkillScope, SkillMetadata, SkillInfo, LoadedSkill } from "./types"

function discoverSkillsFromDir(
  skillsDir: string,
  scope: SkillScope
): Array<{ name: string; description: string; scope: SkillScope }> {
  if (!existsSync(skillsDir)) {
    return []
  }

  const entries = readdirSync(skillsDir, { withFileTypes: true })
  const skills: Array<{ name: string; description: string; scope: SkillScope }> = []

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue

    const skillPath = join(skillsDir, entry.name)

    if (entry.isDirectory() || entry.isSymbolicLink()) {
      let resolvedPath = skillPath
      try {
        const stats = statSync(skillPath, { throwIfNoEntry: false })
        if (stats?.isSymbolicLink()) {
          resolvedPath = resolve(skillPath, "..", readlinkSync(skillPath))
        }
      } catch {
        continue
      }

      const skillMdPath = join(resolvedPath, "SKILL.md")
      if (!existsSync(skillMdPath)) continue

      try {
        const content = readFileSync(skillMdPath, "utf-8")
        const { data } = parseFrontmatter(content)

        skills.push({
          name: data.name || entry.name,
          description: data.description || "",
          scope,
        })
      } catch {
        continue
      }
    }
  }

  return skills
}

function discoverSkillsSync(): Array<{ name: string; description: string; scope: SkillScope }> {
  const userSkillsDir = join(homedir(), ".claude", "skills")
  const projectSkillsDir = join(process.cwd(), ".claude", "skills")

  const userSkills = discoverSkillsFromDir(userSkillsDir, "user")
  const projectSkills = discoverSkillsFromDir(projectSkillsDir, "project")

  return [...projectSkills, ...userSkills]
}

const availableSkills = discoverSkillsSync()
const skillListForDescription = availableSkills
  .map((s) => `- ${s.name}: ${s.description} (${s.scope})`)
  .join("\n")

function resolveSymlink(skillPath: string): string {
  try {
    const stats = statSync(skillPath, { throwIfNoEntry: false })
    if (stats?.isSymbolicLink()) {
      return resolve(skillPath, "..", readlinkSync(skillPath))
    }
    return skillPath
  } catch {
    return skillPath
  }
}

async function parseSkillMd(skillPath: string): Promise<SkillInfo | null> {
  const resolvedPath = resolveSymlink(skillPath)
  const skillMdPath = join(resolvedPath, "SKILL.md")

  if (!existsSync(skillMdPath)) {
    return null
  }

  try {
    let content = readFileSync(skillMdPath, "utf-8")
    content = await resolveCommandsInText(content)
    const { data, body } = parseFrontmatter(content)

    const metadata: SkillMetadata = {
      name: data.name || basename(skillPath),
      description: data.description || "",
      license: data.license,
    }

    const referencesDir = join(resolvedPath, "references")
    const scriptsDir = join(resolvedPath, "scripts")
    const assetsDir = join(resolvedPath, "assets")

    const references = existsSync(referencesDir)
      ? readdirSync(referencesDir).filter((f) => !f.startsWith("."))
      : []

    const scripts = existsSync(scriptsDir)
      ? readdirSync(scriptsDir).filter((f) => !f.startsWith(".") && !f.startsWith("__"))
      : []

    const assets = existsSync(assetsDir)
      ? readdirSync(assetsDir).filter((f) => !f.startsWith("."))
      : []

    return {
      name: metadata.name,
      path: resolvedPath,
      metadata,
      content: body,
      references,
      scripts,
      assets,
    }
  } catch {
    return null
  }
}

async function discoverSkillsFromDirAsync(skillsDir: string): Promise<SkillInfo[]> {
  if (!existsSync(skillsDir)) {
    return []
  }

  const entries = readdirSync(skillsDir, { withFileTypes: true })
  const skills: SkillInfo[] = []

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue

    const skillPath = join(skillsDir, entry.name)

    if (entry.isDirectory() || entry.isSymbolicLink()) {
      const skillInfo = await parseSkillMd(skillPath)
      if (skillInfo) {
        skills.push(skillInfo)
      }
    }
  }

  return skills
}

async function discoverSkills(): Promise<SkillInfo[]> {
  const userSkillsDir = join(homedir(), ".claude", "skills")
  const projectSkillsDir = join(process.cwd(), ".claude", "skills")

  const userSkills = await discoverSkillsFromDirAsync(userSkillsDir)
  const projectSkills = await discoverSkillsFromDirAsync(projectSkillsDir)

  return [...projectSkills, ...userSkills]
}

function findMatchingSkills(skills: SkillInfo[], query: string): SkillInfo[] {
  const queryLower = query.toLowerCase()
  const queryTerms = queryLower.split(/\s+/).filter(Boolean)

  return skills
    .map((skill) => {
      let score = 0
      const nameLower = skill.metadata.name.toLowerCase()
      const descLower = skill.metadata.description.toLowerCase()

      if (nameLower === queryLower) score += 100
      if (nameLower.includes(queryLower)) score += 50

      for (const term of queryTerms) {
        if (nameLower.includes(term)) score += 20
        if (descLower.includes(term)) score += 10
      }

      return { skill, score }
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ skill }) => skill)
}

async function loadSkillWithReferences(
  skill: SkillInfo,
  includeRefs: boolean
): Promise<LoadedSkill> {
  const referencesLoaded: Array<{ path: string; content: string }> = []

  if (includeRefs && skill.references.length > 0) {
    for (const ref of skill.references) {
      const refPath = join(skill.path, "references", ref)
      try {
        let content = readFileSync(refPath, "utf-8")
        content = await resolveCommandsInText(content)
        referencesLoaded.push({ path: ref, content })
      } catch {
      }
    }
  }

  return {
    name: skill.name,
    metadata: skill.metadata,
    body: skill.content,
    referencesLoaded,
  }
}

function formatSkillList(skills: SkillInfo[]): string {
  if (skills.length === 0) {
    return "No skills found in ~/.claude/skills/"
  }

  const lines = ["# Available Skills\n"]

  for (const skill of skills) {
    lines.push(`- **${skill.metadata.name}**: ${skill.metadata.description || "(no description)"}`)
  }

  lines.push(`\n**Total**: ${skills.length} skills`)
  return lines.join("\n")
}

function formatLoadedSkills(loadedSkills: LoadedSkill[]): string {
  if (loadedSkills.length === 0) {
    return "No skills loaded."
  }

  const sections: string[] = ["# Loaded Skills\n"]

  for (const skill of loadedSkills) {
    sections.push(`## ${skill.metadata.name}\n`)
    sections.push(`**Description**: ${skill.metadata.description || "(no description)"}\n`)
    sections.push("### Skill Instructions\n")
    sections.push(skill.body.trim())

    if (skill.referencesLoaded.length > 0) {
      sections.push("\n### Loaded References\n")
      for (const ref of skill.referencesLoaded) {
        sections.push(`#### ${ref.path}\n`)
        sections.push("```")
        sections.push(ref.content.trim())
        sections.push("```\n")
      }
    }

    sections.push("\n---\n")
  }

  const skillNames = loadedSkills.map((s) => s.metadata.name).join(", ")
  sections.push(`**Skills loaded**: ${skillNames}`)
  sections.push(`**Total**: ${loadedSkills.length} skill(s)`)
  sections.push("\nPlease confirm these skills match your needs before proceeding.")

  return sections.join("\n")
}

export const skill = tool({
  description: `Execute a skill within the main conversation.

When users ask you to perform tasks, check if any of the available skills below can help complete the task more effectively. Skills provide specialized capabilities and domain knowledge.

How to use skills:
- Invoke skills using this tool with the skill name only (no arguments)
- When you invoke a skill, the skill's prompt will expand and provide detailed instructions on how to complete the task

Important:
- Only use skills listed in Available Skills below
- Do not invoke a skill that is already running

Skills are loaded from:
- ~/.claude/skills/ (user scope - global skills)
- ./.claude/skills/ (project scope - project-specific skills)

Each skill contains:
- SKILL.md: Main instructions with YAML frontmatter (name, description)
- references/: Documentation files loaded into context as needed
- scripts/: Executable code for deterministic operations
- assets/: Files used in output (templates, icons, etc.)

Available Skills:
${skillListForDescription}`,

  args: {
    skill: tool.schema
      .string()
      .describe(
        "The skill name or search query to find and load. Can be exact skill name (e.g., 'python-programmer') or keywords (e.g., 'python', 'plan')."
      ),
  },

  async execute(args) {
    const skills = await discoverSkills()

    if (!args.skill) {
      return formatSkillList(skills) + "\n\nProvide a skill name to load."
    }

    const matchingSkills = findMatchingSkills(skills, args.skill)

    if (matchingSkills.length === 0) {
      return (
        `No skills found matching "${args.skill}".\n\n` +
        formatSkillList(skills) +
        "\n\nTry a different skill name."
      )
    }

    const loadedSkills: LoadedSkill[] = []

    for (const skillInfo of matchingSkills.slice(0, 3)) {
      const loaded = await loadSkillWithReferences(skillInfo, true)
      loadedSkills.push(loaded)
    }

    return formatLoadedSkills(loadedSkills)
  },
})
