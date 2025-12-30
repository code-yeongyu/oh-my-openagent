import { dirname } from "node:path"
import { readFileSync } from "node:fs"
import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { TOOL_DESCRIPTION_NO_SKILLS, TOOL_DESCRIPTION_PREFIX } from "./constants"
import type { SkillArgs, SkillInfo, SkillLoadOptions } from "./types"
import { discoverSkills, getSkillByName, type LoadedSkill } from "../../features/opencode-skill-loader"
import { parseFrontmatter } from "../../shared/frontmatter"

function loadedSkillToInfo(skill: LoadedSkill): SkillInfo {
  return {
    name: skill.name,
    description: skill.definition.description || "",
    location: skill.path,
    scope: skill.scope,
    license: skill.license,
    compatibility: skill.compatibility,
    metadata: skill.metadata,
    allowedTools: skill.allowedTools,
  }
}

function formatSkillsXml(skills: SkillInfo[]): string {
  if (skills.length === 0) return ""

  const skillsXml = skills.map(skill => {
    const lines = [
      "  <skill>",
      `    <name>${skill.name}</name>`,
      `    <description>${skill.description}</description>`,
    ]
    if (skill.compatibility) {
      lines.push(`    <compatibility>${skill.compatibility}</compatibility>`)
    }
    lines.push("  </skill>")
    return lines.join("\n")
  }).join("\n")

  return `\n\n<available_skills>\n${skillsXml}\n</available_skills>`
}

export function createSkillTool(options: SkillLoadOptions = {}): ToolDefinition {
  const skills = discoverSkills({ includeClaudeCodePaths: !options.opencodeOnly })
  const skillInfos = skills.map(loadedSkillToInfo)

  const description = skillInfos.length === 0
    ? TOOL_DESCRIPTION_NO_SKILLS
    : TOOL_DESCRIPTION_PREFIX + formatSkillsXml(skillInfos)

  return tool({
    description,
    args: {
      name: tool.schema.string().describe("The skill identifier from available_skills (e.g., 'code-review')"),
    },
    async execute(args: SkillArgs) {
      const skill = getSkillByName(args.name, { includeClaudeCodePaths: !options.opencodeOnly })

      if (!skill) {
        const available = skills.map(s => s.name).join(", ")
        throw new Error(`Skill "${args.name}" not found. Available skills: ${available || "none"}`)
      }

      const content = readFileSync(skill.path, "utf-8")
      const { body } = parseFrontmatter(content)
      const dir = dirname(skill.path)

      const output = [
        `## Skill: ${skill.name}`,
        "",
        `**Base directory**: ${dir}`,
        "",
        body.trim(),
      ].join("\n")

      return output
    },
  })
}

export const skill = createSkillTool()
