import { dirname } from "node:path"
import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { TOOL_DESCRIPTION_NO_SKILLS, TOOL_DESCRIPTION_PREFIX } from "./constants"
import type { SkillArgs, SkillInfo, SkillLoadOptions } from "./types"
import type { LoadedSkill } from "../../features/opencode-skill-loader"
import { getAllSkills, extractSkillTemplate } from "../../features/opencode-skill-loader/skill-content"
import { injectGitMasterConfig } from "../../features/opencode-skill-loader/skill-content"
import type { SkillMcpManager, SkillMcpClientInfo, SkillMcpServerContext } from "../../features/skill-mcp-manager"
import type { Tool, Resource, Prompt } from "@modelcontextprotocol/sdk/types.js"

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

async function extractSkillBody(skill: LoadedSkill): Promise<string> {
  if (skill.lazyContent) {
    const fullTemplate = await skill.lazyContent.load()
    const templateMatch = fullTemplate.match(/<skill-instruction>([\s\S]*?)<\/skill-instruction>/)
    return templateMatch ? templateMatch[1].trim() : fullTemplate
  }

  if (skill.path) {
    return extractSkillTemplate(skill)
  }

  const templateMatch = skill.definition.template?.match(/<skill-instruction>([\s\S]*?)<\/skill-instruction>/)
  return templateMatch ? templateMatch[1].trim() : skill.definition.template || ""
}

async function formatMcpCapabilities(
  skill: LoadedSkill,
  manager: SkillMcpManager,
  sessionID: string
): Promise<string | null> {
  if (!skill.mcpConfig || Object.keys(skill.mcpConfig).length === 0) {
    return null
  }

  const sections: string[] = ["", "## Available MCP Servers", ""]

  for (const [serverName, config] of Object.entries(skill.mcpConfig)) {
    const info: SkillMcpClientInfo = {
      serverName,
      skillName: skill.name,
      sessionID,
    }
    const context: SkillMcpServerContext = {
      config,
      skillName: skill.name,
    }

    sections.push(`### ${serverName}`)
    sections.push("")

    try {
      const [tools, resources, prompts] = await Promise.all([
        manager.listTools(info, context).catch(() => []),
        manager.listResources(info, context).catch(() => []),
        manager.listPrompts(info, context).catch(() => []),
      ])

      if (tools.length > 0) {
        sections.push("**Tools:**")
        sections.push("")
        for (const t of tools as Tool[]) {
          sections.push(`#### \`${t.name}\``)
          if (t.description) {
            sections.push(t.description)
          }
          sections.push("")
          sections.push("**inputSchema:**")
          sections.push("```json")
          sections.push(JSON.stringify(t.inputSchema, null, 2))
          sections.push("```")
          sections.push("")
        }
      }
      if (resources.length > 0) {
        sections.push(`**Resources**: ${resources.map((r: Resource) => r.uri).join(", ")}`)
      }
      if (prompts.length > 0) {
        sections.push(`**Prompts**: ${prompts.map((p: Prompt) => p.name).join(", ")}`)
      }

      if (tools.length === 0 && resources.length === 0 && prompts.length === 0) {
        sections.push("*No capabilities discovered*")
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      sections.push(`*Failed to connect: ${errorMessage.split("\n")[0]}*`)
    }

    sections.push("")
    sections.push(`Use \`skill_mcp\` tool with \`mcp_name="${serverName}"\` to invoke.`)
    sections.push("")
  }

  return sections.join("\n")
}

export function createSkillTool(options: SkillLoadOptions = {}): ToolDefinition {
  let cachedSkills: LoadedSkill[] | null = null
  let cachedDescription: string | null = null

  const getSkills = async (): Promise<LoadedSkill[]> => {
    if (options.skills) return options.skills
    if (cachedSkills) return cachedSkills
    cachedSkills = await getAllSkills()
    return cachedSkills
  }

  const getDescription = async (): Promise<string> => {
    if (cachedDescription) return cachedDescription
    const skills = await getSkills()
    const skillInfos = skills.map(loadedSkillToInfo)
    cachedDescription = skillInfos.length === 0
      ? TOOL_DESCRIPTION_NO_SKILLS
      : TOOL_DESCRIPTION_PREFIX + formatSkillsXml(skillInfos)
    return cachedDescription
  }

  if (options.skills) {
    const skillInfos = options.skills.map(loadedSkillToInfo)
    cachedDescription = skillInfos.length === 0
      ? TOOL_DESCRIPTION_NO_SKILLS
      : TOOL_DESCRIPTION_PREFIX + formatSkillsXml(skillInfos)
  } else {
    getDescription()
  }

  return tool({
    get description() {
      return cachedDescription ?? TOOL_DESCRIPTION_PREFIX
    },
    args: {
      name: tool.schema.string().describe("The skill identifier from available_skills (e.g., 'code-review')"),
    },
    async execute(args: SkillArgs, ctx?: { agent?: string }) {
      const skills = await getSkills()
      const skill = skills.find(s => s.name === args.name)

      if (!skill) {
        const available = skills.map(s => s.name).join(", ")
        throw new Error(`Skill "${args.name}" not found. Available skills: ${available || "none"}`)
      }

      if (skill.definition.agent && (!ctx?.agent || skill.definition.agent !== ctx.agent)) {
        throw new Error(`Skill "${args.name}" is restricted to agent "${skill.definition.agent}"`)
      }

      let body = await extractSkillBody(skill)

      if (args.name === "git-master") {
        body = injectGitMasterConfig(body, options.gitMasterConfig)
      }

      const dir = skill.path ? dirname(skill.path) : skill.resolvedPath || process.cwd()

      const output = [
        `## Skill: ${skill.name}`,
        "",
        `**Base directory**: ${dir}`,
        "",
        body,
      ]

      if (options.mcpManager && options.getSessionID && skill.mcpConfig) {
        const mcpInfo = await formatMcpCapabilities(
          skill,
          options.mcpManager,
          options.getSessionID()
        )
        if (mcpInfo) {
          output.push(mcpInfo)
        }
      }

      return output.join("\n")
    },
  })
}

export const skill: ToolDefinition = createSkillTool()
