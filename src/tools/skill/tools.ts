import { dirname } from "node:path"
import { readFileSync } from "node:fs"
import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { TOOL_DESCRIPTION_NO_SKILLS, TOOL_DESCRIPTION_PREFIX } from "./constants"
import type { SkillArgs, SkillInfo, SkillLoadOptions } from "./types"
import { discoverSkills, type LoadedSkill } from "../../features/opencode-skill-loader"
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

function extractSkillBody(skill: LoadedSkill): string {
  if (skill.path) {
    const content = readFileSync(skill.path, "utf-8")
    const { body } = parseFrontmatter(content)
    return body.trim()
  }

  const templateMatch = skill.definition.template?.match(/<skill-instruction>([\s\S]*?)<\/skill-instruction>/)
  return templateMatch ? templateMatch[1].trim() : skill.definition.template || ""
}

export function createSkillTool(options: SkillLoadOptions = {}): ToolDefinition {
  const skills = options.skills ?? discoverSkills({ includeClaudeCodePaths: !options.opencodeOnly })
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
      const skill = options.skills
        ? skills.find(s => s.name === args.name)
        : skills.find(s => s.name === args.name)

      if (!skill) {
        const available = skills.map(s => s.name).join(", ")
        throw new Error(`Skill "${args.name}" not found. Available skills: ${available || "none"}`)
      }

      const body = extractSkillBody(skill)
      const dir = skill.path ? dirname(skill.path) : skill.resolvedPath || process.cwd()

      return [
        `## Skill: ${skill.name}`,
        "",
        `**Base directory**: ${dir}`,
        "",
        body,
      ].join("\n")
    },
  })
}

export const skill = createSkillTool()
