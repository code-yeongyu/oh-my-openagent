import { dirname } from "node:path"
import type { LoadedSkill } from "../../features/opencode-skill-loader"
import { extractSkillTemplate } from "../../features/opencode-skill-loader/skill-content"
import { injectGitMasterConfig as injectGitMasterConfigOriginal } from "../../features/opencode-skill-loader/skill-content"
import type { SkillMcpManager, SkillMcpClientInfo, SkillMcpServerContext } from "../../features/skill-mcp-manager"
import type { Tool, Resource, Prompt } from "@modelcontextprotocol/sdk/types.js"
import type { GitMasterConfig } from "../../config/schema/git-master"

export async function extractSkillBody(skill: LoadedSkill): Promise<string> {
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

export async function formatMcpCapabilities(
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

export { injectGitMasterConfigOriginal as injectGitMasterConfig }

export async function formatSkillOutput(
  skill: LoadedSkill,
  mcpManager?: SkillMcpManager,
  getSessionID?: () => string,
  gitMasterConfig?: GitMasterConfig
): Promise<string> {
  let body = await extractSkillBody(skill)

  if (skill.name === "git-master") {
    body = injectGitMasterConfigOriginal(body, gitMasterConfig)
  }

  const dir = skill.path ? dirname(skill.path) : skill.resolvedPath || process.cwd()

  const output = [
    `## Skill: ${skill.name}`,
    "",
    `**Base directory**: ${dir}`,
    "",
    body,
  ]

  if (mcpManager && getSessionID && skill.mcpConfig) {
    const mcpInfo = await formatMcpCapabilities(
      skill,
      mcpManager,
      getSessionID()
    )
    if (mcpInfo) {
      output.push(mcpInfo)
    }
  }

  return output.join("\n")
}
